import { NextRequest, NextResponse, after } from "next/server";
import { requireExternalApiAuth } from "@/lib/external-auth";
import { consumeApiRateLimit } from "@/lib/rate-limit";
import { validateExternalDateRangeQuery } from "@/lib/request-validation";
import { fetchAccounts } from "@/lib/meta";
import { dedupeAccounts, dedupeInsights } from "@/lib/dedupe";
import { deleteServerCache, getServerCache } from "@/lib/server-cache";
import { enumerateDates, getEffectiveSettlingWindow, logSyncError, readInsightRows, recentWindowState, splitDateRange, StoredInsightRow } from "@/lib/insights-store";
import { syncRange } from "@/lib/insights-sync";
import { sumReportingRows } from "@/lib/reporting";

/**
 * API สำหรับระบบภายนอก (เช่น Qlass) ดึงยอดใช้จ่ายโฆษณารวมทุกบัญชี ไปคำนวณ CPO เอง
 * — คนละ auth กับหน้าเว็บภายใน ดู lib/external-auth.ts
 *
 * GET /api/external/ads-spend?since=2026-08-01&until=2026-08-31[&groupBy=day]
 * Header: Authorization: Bearer <EXTERNAL_API_KEY>
 * → { since, until, spend, currency: "THB", asOf, daily? }
 * `daily` ปรากฏเฉพาะเมื่อขอ groupBy=day และช่วงไม่เกิน MAX_DAILY_BREAKDOWN_DAYS วัน
 * (เกินนั้นตอบ 200 ตามปกติแต่ daily: null — ไม่ 400 ทั้ง request)
 *
 * ความสด: เสิร์ฟจาก Postgres เสมอ แล้ว sync กับ Meta เบื้องหลังไม่เกินชั่วโมงละครั้ง
 * (คนละรอบกับหน้าเว็บภายในที่ใช้ 10 นาที — Qlass ขอแค่ "ทุกชั่วโมงก็พอ" เอง
 * จึงไม่ยิง Meta ถี่กว่านั้นแม้ Qlass จะเรียก endpoint นี้ถี่แค่ไหนก็ตาม)
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const HOUR_MS = 60 * 60 * 1000;
const CACHE_TTL_MS = HOUR_MS;
const CACHE_STALE_TTL_MS = 6 * HOUR_MS;
const RECENT_SYNC_MAX_AGE_MS = HOUR_MS;
const ACCOUNTS_CACHE_TTL_MS = 10 * 60 * 1000;
const ACCOUNTS_STALE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_DAILY_BREAKDOWN_DAYS = 100;

interface AdsSpendResult {
  spend: number;
  daily: Array<{ day: string; spend: number }> | null;
}

function buildDailyBreakdown(rows: StoredInsightRow[], since: string, until: string): Array<{ day: string; spend: number }> | null {
  const days = enumerateDates(since, until);
  if (days.length > MAX_DAILY_BREAKDOWN_DAYS) return null;
  const byDay = new Map<string, StoredInsightRow[]>(days.map((day) => [day, []]));
  for (const row of rows) {
    byDay.get(row.date)?.push(row);
  }
  return days.map((day) => ({ day, spend: Math.round(sumReportingRows(byDay.get(day) ?? []).spend) }));
}

export async function GET(req: NextRequest) {
  const denied = requireExternalApiAuth(req);
  if (denied) return denied;

  const rate = consumeApiRateLimit(req.headers, "external-ads-spend", 120, 60_000);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "เรียกข้อมูลบ่อยเกินไป" },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } }
    );
  }

  const validation = validateExternalDateRangeQuery(req.nextUrl.searchParams);
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }
  const { since, until, groupBy } = validation.value;

  const tokens = [
    process.env.META_ACCESS_TOKEN,
    process.env.META_ACCESS_TOKEN_2,
    process.env.META_ACCESS_TOKEN_3,
  ].filter(Boolean) as string[];

  if (tokens.length === 0) {
    return NextResponse.json({ error: "No META_ACCESS_TOKEN configured" }, { status: 500 });
  }

  try {
    const asOf = new Date();

    // รายชื่อบัญชีต่อ token — ใช้ cache key ร่วมกับหน้าเว็บภายใน (app/api/insights)
    // เพื่อไม่ต้องยิง Meta ซ้ำถ้ามีใครเปิดหน้าเว็บอยู่แล้ว
    const accountResults = await Promise.all(
      tokens.map((token, tokenIndex) =>
        getServerCache(`accounts:${tokenIndex}`, ACCOUNTS_CACHE_TTL_MS, () => fetchAccounts(token), false, { staleTtlMs: ACCOUNTS_STALE_TTL_MS })
      )
    );
    const accountIds = dedupeAccounts(accountResults.flatMap((r) => r.value.accounts)).map((a) => a.id);

    const settlingWindowDays = await getEffectiveSettlingWindow();
    const { recentDates } = splitDateRange(since, until, asOf, settlingWindowDays);
    const recentState = await recentWindowState(accountIds, recentDates, RECENT_SYNC_MAX_AGE_MS);
    const deferSync = recentState.covered && !recentState.fresh;

    const cacheKey = `external-ads-spend:${since}:${until}:${groupBy ?? "total"}`;

    if (deferSync) {
      after(async () => {
        try {
          await Promise.all(tokens.map((token) => syncRange(token, accountIds, since, until, asOf, { settlingWindowDays })));
          deleteServerCache(cacheKey);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.warn("[external-ads-spend background-sync] failed:", message);
          await logSyncError(`external-ads-spend ${since}..${until}`, message);
        }
      });
    }

    const cached = await getServerCache<AdsSpendResult>(cacheKey, CACHE_TTL_MS, async () => {
      // final ที่ขาด + recent ตามโหมดที่ตัดสินไว้ข้างบน (ปกติทั้งคู่เป็น no-op)
      await Promise.all(
        tokens.map((token) => syncRange(token, accountIds, since, until, asOf, { skipRecent: deferSync, settlingWindowDays }))
      );
      const rows = dedupeInsights(await readInsightRows(accountIds, since, until));
      return {
        spend: sumReportingRows(rows).spend,
        daily: groupBy === "day" ? buildDailyBreakdown(rows, since, until) : null,
      };
    }, false, { staleTtlMs: CACHE_STALE_TTL_MS });

    const body: Record<string, unknown> = {
      since,
      until,
      spend: Math.round(cached.value.spend),
      currency: "THB",
      asOf: asOf.toISOString(),
    };
    if (groupBy === "day") {
      body.daily = cached.value.daily;
    }

    return NextResponse.json(body, { headers: { "Cache-Control": "private, no-store" } });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    await logSyncError(`external-ads-spend ${since}..${until}`, message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
