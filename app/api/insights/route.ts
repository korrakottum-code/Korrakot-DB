import { NextRequest, NextResponse } from "next/server";
import { fetchAllInsights } from "@/lib/meta";
import { dedupeAccounts, dedupeInsights } from "@/lib/dedupe";
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

function getPresetRanges(preset: string): {
  current: { since: string; until: string };
  previous: { since: string; until: string };
} {
  const today = toZonedTime(new Date(), TZ);
  
  let currentSince: Date;
  let currentUntil: Date;
  let prevSince: Date;
  let prevUntil: Date;

  const fmtStr = "yyyy-MM-dd";

  switch (preset) {
    case "today":
      currentSince = today;
      currentUntil = today;
      prevSince = subDays(today, 1);
      prevUntil = subDays(today, 1);
      break;
    case "yesterday":
      currentSince = subDays(today, 1);
      currentUntil = subDays(today, 1);
      prevSince = subDays(today, 2);
      prevUntil = subDays(today, 2);
      break;
    case "last_7d":
      currentSince = subDays(today, 6);
      currentUntil = today;
      prevSince = subDays(today, 13);
      prevUntil = subDays(today, 7);
      break;
    case "last_30d":
      currentSince = subDays(today, 29);
      currentUntil = today;
      prevSince = subDays(today, 59);
      prevUntil = subDays(today, 30);
      break;
    case "this_month":
      currentSince = startOfMonth(today);
      currentUntil = today;
      
      const lastMonth = subMonths(today, 1);
      prevSince = startOfMonth(lastMonth);
      prevUntil = endOfMonth(lastMonth);
      break;
    case "last_month":
      const lm = subMonths(today, 1);
      currentSince = startOfMonth(lm);
      currentUntil = endOfMonth(lm);
      
      const twoMonthsAgo = subMonths(today, 2);
      prevSince = startOfMonth(twoMonthsAgo);
      prevUntil = endOfMonth(twoMonthsAgo);
      break;
    default:
      currentSince = subDays(today, 29);
      currentUntil = today;
      prevSince = subDays(today, 59);
      prevUntil = subDays(today, 30);
  }

  return {
    current: {
      since: format(currentSince, fmtStr),
      until: format(currentUntil, fmtStr),
    },
    previous: {
      since: format(prevSince, fmtStr),
      until: format(prevUntil, fmtStr),
    },
  };
}

export async function GET(req: NextRequest) {
  const denied = requireInternalApiAuth(req);
  if (denied) return denied;

  const requestRate = consumeApiRateLimit(req.headers, "insights", 120, 60_000);
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
    const refreshRate = consumeApiRateLimit(req.headers, "insights-refresh", 6, 60_000);
    if (!refreshRate.allowed) {
      return NextResponse.json(
        { error: "กดรีเฟรชบ่อยเกินไป กรุณารอสักครู่" },
        { status: 429, headers: { "Retry-After": String(refreshRate.retryAfterSeconds) } }
      );
    }
  }

  try {
    let ranges: { current: { since: string; until: string }; previous: { since: string; until: string } };

    if (customSince && customUntil) {
      // Custom date range: compute previous period of equal length
      const sinceDate = new Date(customSince);
      const untilDate = new Date(customUntil);
      const daysDiff = Math.round((untilDate.getTime() - sinceDate.getTime()) / (1000 * 60 * 60 * 24));
      const prevUntilDate = subDays(sinceDate, 1);
      const prevSinceDate = subDays(prevUntilDate, daysDiff);
      ranges = {
        current: { since: customSince, until: customUntil },
        previous: { since: format(prevSinceDate, "yyyy-MM-dd"), until: format(prevUntilDate, "yyyy-MM-dd") },
      };
    } else {
      ranges = getPresetRanges(datePreset);
    }

    const cacheKey = [
      "insights",
      ranges.current.since,
      ranges.current.until,
      ranges.previous.since,
      ranges.previous.until,
    ].join(":");
    const cached = await getServerCache(cacheKey, CACHE_TTL_MS, async () => {
      // Fetch current and previous period insights concurrently.
      const [currentResults, prevResults] = await Promise.all([
        Promise.all(tokens.map((token) => fetchAllInsights(token, undefined, ranges.current.since, ranges.current.until))),
        Promise.all(tokens.map((token) => fetchAllInsights(token, undefined, ranges.previous.since, ranges.previous.until))),
      ]);

      const insights = dedupeInsights(currentResults.flatMap((r) => r.insights));
      const previousInsights = dedupeInsights(prevResults.flatMap((r) => r.insights));
      const accounts = dedupeAccounts(currentResults.flatMap((r) => r.accounts));
      const failures = [
        ...currentResults.flatMap((r, tokenIndex) =>
          r.failures.map((failure) => ({ ...failure, tokenIndex: tokenIndex + 1, period: "current" }))
        ),
        ...prevResults.flatMap((r, tokenIndex) =>
          r.failures.map((failure) => ({ ...failure, tokenIndex: tokenIndex + 1, period: "previous" }))
        ),
      ];

      return { insights, previousInsights, accounts, failures };
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
