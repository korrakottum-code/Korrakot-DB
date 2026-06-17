import { NextRequest, NextResponse } from "next/server";
import { fetchAllCampaignData } from "@/lib/meta";
import { subDays, startOfMonth, endOfMonth, subMonths, format } from "date-fns";
import { toZonedTime } from "date-fns-tz";

const TZ = "Asia/Bangkok";

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
  const customSince = searchParams.get("since");
  const customUntil = searchParams.get("until");

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

    const allResults = await Promise.all(
      tokens.map((token) => fetchAllCampaignData(token, datePreset, since, until))
    );

    const campaigns = allResults.flatMap((r) => r.campaigns);
    const accounts = allResults.flatMap((r) => r.accounts);

    return NextResponse.json({ campaigns, accounts });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
