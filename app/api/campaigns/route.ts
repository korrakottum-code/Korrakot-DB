import { NextRequest, NextResponse } from "next/server";
import { fetchAllCampaignData } from "@/lib/meta";
import { dedupeAccounts, dedupeCampaigns } from "@/lib/dedupe";
import { getServerCache } from "@/lib/server-cache";
import { consumeApiRateLimit } from "@/lib/rate-limit";
import { validateDateQuery } from "@/lib/request-validation";
import { requireInternalApiAuth } from "@/lib/api-auth";
import { subDays, startOfMonth, endOfMonth, subMonths, format } from "date-fns";
import { toZonedTime } from "date-fns-tz";

const TZ = "Asia/Bangkok";
const CACHE_TTL_MS = 10 * 60 * 1000;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getPresetRange(preset: string): { since: string; until: string } {
  const today = toZonedTime(new Date(), TZ);
  const fmt = "yyyy-MM-dd";
  switch (preset) {
    case "today":
      return { since: format(today, fmt), until: format(today, fmt) };
    case "yesterday": {
      const y = subDays(today, 1);
      return { since: format(y, fmt), until: format(y, fmt) };
    }
    case "last_7d":
      return { since: format(subDays(today, 6), fmt), until: format(today, fmt) };
    case "last_30d":
      return { since: format(subDays(today, 29), fmt), until: format(today, fmt) };
    case "this_month":
      return { since: format(startOfMonth(today), fmt), until: format(today, fmt) };
    case "last_month": {
      const lm = subMonths(today, 1);
      return { since: format(startOfMonth(lm), fmt), until: format(endOfMonth(lm), fmt) };
    }
    default:
      return { since: format(subDays(today, 29), fmt), until: format(today, fmt) };
  }
}

export async function GET(req: NextRequest) {
  const denied = requireInternalApiAuth(req);
  if (denied) return denied;

  const requestRate = consumeApiRateLimit(req.headers, "campaigns", 120, 60_000);
  if (!requestRate.allowed) {
    return NextResponse.json(
      { error: "เรียกข้อมูลบ่อยเกินไป" },
      { status: 429, headers: { "Retry-After": String(requestRate.retryAfterSeconds) } }
    );
  }

  const tokens = [
    process.env.META_ACCESS_TOKEN,
    process.env.META_ACCESS_TOKEN_2,
    process.env.META_ACCESS_TOKEN_3,
  ].filter(Boolean) as string[];

  if (tokens.length === 0) {
    return NextResponse.json({ error: "No META_ACCESS_TOKEN configured" }, { status: 500 });
  }

  const validation = validateDateQuery(req.nextUrl.searchParams);
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }
  const {
    datePreset,
    since: customSince,
    until: customUntil,
    forceRefresh,
  } = validation.value;
  if (forceRefresh) {
    const refreshRate = consumeApiRateLimit(req.headers, "campaigns-refresh", 6, 60_000);
    if (!refreshRate.allowed) {
      return NextResponse.json(
        { error: "กดรีเฟรชบ่อยเกินไป กรุณารอสักครู่" },
        { status: 429, headers: { "Retry-After": String(refreshRate.retryAfterSeconds) } }
      );
    }
  }

  try {
    let since: string | undefined;
    let until: string | undefined;

    if (customSince && customUntil) {
      since = customSince;
      until = customUntil;
    } else {
      const range = getPresetRange(datePreset);
      since = range.since;
      until = range.until;
    }

    const cacheKey = ["campaigns", since, until].join(":");
    const cached = await getServerCache(cacheKey, CACHE_TTL_MS, async () => {
      const allResults = await Promise.all(
        tokens.map((token) => fetchAllCampaignData(token, datePreset, since, until))
      );

      const campaigns = dedupeCampaigns(allResults.flatMap((r) => r.campaigns));
      const accounts = dedupeAccounts(allResults.flatMap((r) => r.accounts));
      const failures = allResults.flatMap((r, tokenIndex) =>
        r.failures.map((failure) => ({ ...failure, tokenIndex: tokenIndex + 1 }))
      );

      return { campaigns, accounts, failures };
    }, forceRefresh);

    return NextResponse.json({
      ...cached.value,
      cache: { hit: cached.hit, fetchedAt: cached.fetchedAt },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
