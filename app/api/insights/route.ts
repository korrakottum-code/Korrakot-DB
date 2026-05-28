import { NextRequest, NextResponse } from "next/server";
import { fetchAllInsights } from "@/lib/meta";
import { subDays, startOfMonth, endOfMonth, subMonths, format } from "date-fns";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getPresetRanges(preset: string): {
  current: { since: string; until: string };
  previous: { since: string; until: string };
} {
  const today = new Date();
  
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
  const tokens = [
    process.env.META_ACCESS_TOKEN,
    process.env.META_ACCESS_TOKEN_2,
    process.env.META_ACCESS_TOKEN_3,
  ].filter(Boolean) as string[];

  if (tokens.length === 0) {
    return NextResponse.json({ error: "No META_ACCESS_TOKEN configured" }, { status: 500 });
  }

  const { searchParams } = new URL(req.url);
  const datePreset = searchParams.get("date_preset") || "last_30d";

  try {
    const ranges = getPresetRanges(datePreset);

    // Fetch current and previous period insights concurrently
    const [currentResults, prevResults] = await Promise.all([
      Promise.all(tokens.map((token) => fetchAllInsights(token, undefined, ranges.current.since, ranges.current.until))),
      Promise.all(tokens.map((token) => fetchAllInsights(token, undefined, ranges.previous.since, ranges.previous.until))),
    ]);

    const insights = currentResults.flatMap((r) => r.insights);
    const previousInsights = prevResults.flatMap((r) => r.insights);
    const accounts = currentResults.flatMap((r) => r.accounts);

    return NextResponse.json({ insights, previousInsights, accounts });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
