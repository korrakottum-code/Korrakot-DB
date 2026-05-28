import { NextRequest, NextResponse } from "next/server";
import { fetchAllInsights } from "@/lib/meta";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
  const since = searchParams.get("since") || undefined;
  const until = searchParams.get("until") || undefined;

  try {
    const results = await Promise.all(
      tokens.map((token) => fetchAllInsights(token, datePreset, since, until))
    );
    const allInsights = results.flatMap((r) => r.insights);
    const allAccounts = results.flatMap((r) => r.accounts);
    return NextResponse.json({ insights: allInsights, accounts: allAccounts });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
