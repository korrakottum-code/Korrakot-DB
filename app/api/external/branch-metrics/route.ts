import { NextRequest, NextResponse, after } from "next/server";
import { requireExternalApiAuth } from "@/lib/external-auth";
import { consumeApiRateLimit } from "@/lib/rate-limit";
import { validateExternalDateRangeQuery } from "@/lib/request-validation";
import { fetchAccounts } from "@/lib/meta";
import { dedupeAccounts, dedupeInsights } from "@/lib/dedupe";
import { deleteServerCache, getServerCache } from "@/lib/server-cache";
import {
  getEffectiveSettlingWindow,
  logSyncError,
  readInsightRows,
  recentWindowState,
  splitDateRange,
} from "@/lib/insights-store";
import { syncRange } from "@/lib/insights-sync";
import { getBranchMap, getTestBranchCodes, getTestBranchNames, parseAdName } from "@/lib/parser";
import { hydrateParserConfig } from "@/lib/parser-config-store";
import { aggregateBranchMetrics } from "@/lib/branch-metrics";

/**
 * API สำหรับระบบภายนอก (เช่น แดชบอร์ดผู้บริหาร) ดึงผลโฆษณา **แยกรายสาขา**
 * — ต่างจาก `/api/external/ads-spend` ที่ให้ยอดใช้จ่ายรวมก้อนเดียว
 *
 * GET /api/external/branch-metrics?since=2026-08-01&until=2026-08-31
 * Header: Authorization: Bearer <EXTERNAL_API_KEY>   (คีย์เดียวกับ ads-spend)
 *
 * → {
 *     since, until, currency: "THB", asOf,
 *     totals:   { spend, impressions, reach, clicks, inbox, leads, ctr, cpc, cpm, cpi, cpl },
 *     branches: [ { code, name, dimension, ...metrics } ]  เรียงตาม spend มากไปน้อย
 *     excluded: [ { dimension, ads, spend } ]  ยอดที่ไม่ใช่สาขาขาย เพื่อให้กระทบยอดได้
 *   }
 *
 * นับเฉพาะสาขาขายจริง (dimension = branch | class_go) ส่วนเพจหลัก หน้าบ้าน IG HR
 * ส่วนกลาง สาขาทดสอบ และแอดที่พาร์สชื่อไม่ออก จะอยู่ใน excluded ไม่ปนกับ branches
 *
 * ความสด: เสิร์ฟจาก Postgres เสมอ แล้ว sync กับ Meta เบื้องหลังไม่เกินชั่วโมงละครั้ง
 * (กติกาเดียวกับ ads-spend — เรียกถี่แค่ไหนก็ไม่ยิง Meta ถี่กว่านั้น)
 *
 * เป็น read-only ทั้งหมด ไม่มีคำสั่งแก้แคมเปญหรือเปลี่ยนงบใน Meta
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

export async function GET(req: NextRequest) {
  const denied = requireExternalApiAuth(req);
  if (denied) return denied;

  const rate = consumeApiRateLimit(req.headers, "external-branch-metrics", 120, 60_000);
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
  const { since, until } = validation.value;

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

    // ใช้ branch map ชุดเดียวกับหน้าเว็บภายใน (DB > branch-config.json > hardcode)
    await hydrateParserConfig();

    const accountResults = await Promise.all(
      tokens.map((token, tokenIndex) =>
        getServerCache(`accounts:${tokenIndex}`, ACCOUNTS_CACHE_TTL_MS, () => fetchAccounts(token), false, {
          staleTtlMs: ACCOUNTS_STALE_TTL_MS,
        })
      )
    );
    const accounts = dedupeAccounts(accountResults.flatMap((r) => r.value.accounts));
    const accountIds = accounts.map((a) => a.id);

    const settlingWindowDays = await getEffectiveSettlingWindow();
    const { recentDates } = splitDateRange(since, until, asOf, settlingWindowDays);
    const recentState = await recentWindowState(accountIds, recentDates, RECENT_SYNC_MAX_AGE_MS);
    const deferSync = recentState.covered && !recentState.fresh;

    const cacheKey = `external-branch-metrics:${since}:${until}`;

    if (deferSync) {
      after(async () => {
        try {
          await Promise.all(
            tokens.map((token) => syncRange(token, accountIds, since, until, asOf, { settlingWindowDays }))
          );
          deleteServerCache(cacheKey);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.warn("[external-branch-metrics background-sync] failed:", message);
          await logSyncError(`external-branch-metrics ${since}..${until}`, message);
        }
      });
    }

    const cached = await getServerCache(
      cacheKey,
      CACHE_TTL_MS,
      async () => {
        await Promise.all(
          tokens.map((token) =>
            syncRange(token, accountIds, since, until, asOf, { skipRecent: deferSync, settlingWindowDays })
          )
        );
        const stored = dedupeInsights(await readInsightRows(accountIds, since, until));
        const rows = stored.map((row) => ({
          parsed: parseAdName(row.adName),
          spend: row.spend,
          impressions: row.impressions,
          reach: row.reach,
          clicks: row.clicks,
          inbox: row.inbox,
          leads: row.leads,
        }));
        return aggregateBranchMetrics(rows, {
          branchMap: getBranchMap(),
          testBranchCodes: getTestBranchCodes(),
          testBranchNames: getTestBranchNames(),
        });
      },
      false,
      { staleTtlMs: CACHE_STALE_TTL_MS }
    );

    return NextResponse.json(
      {
        since,
        until,
        currency: "THB",
        asOf: asOf.toISOString(),
        totals: cached.value.totals,
        branches: cached.value.branches,
        excluded: cached.value.excluded,
      },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    await logSyncError(`external-branch-metrics ${since}..${until}`, message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
