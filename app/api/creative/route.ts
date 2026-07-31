import { NextRequest, NextResponse } from "next/server";
import { groupCreativeRequests } from "@/lib/creative-routing";
import { consumeApiRateLimit } from "@/lib/rate-limit";
import { validateCreativeQuery } from "@/lib/request-validation";
import { requireInternalApiAuth } from "@/lib/api-auth";
import { buildTokenByAccount, fetchCreativeAssets } from "@/lib/creative-assets";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Creative assets can belong to different ad accounts. Route each request through
// a token that can access its account instead of always using token #1.
export async function GET(req: NextRequest) {
  const denied = requireInternalApiAuth(req);
  if (denied) return denied;

  const rate = consumeApiRateLimit(req.headers, "creative", 60, 60_000);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "เรียกข้อมูล Creative บ่อยเกินไป" },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } }
    );
  }

  const tokens = [
    process.env.META_ACCESS_TOKEN,
    process.env.META_ACCESS_TOKEN_2,
    process.env.META_ACCESS_TOKEN_3,
  ].filter(Boolean) as string[];
  if (!tokens.length) return NextResponse.json({ error: "No token" }, { status: 500 });

  const { searchParams } = new URL(req.url);
  const validation = validateCreativeQuery(searchParams);
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }
  const { adIds: rawAdIds, accountIds: rawAccountIds } = validation.value;
  const pairs = rawAdIds.map((adId, index) => ({ adId, accountId: rawAccountIds[index] || "" }));
  const uniquePairs = [...new Map(pairs.map((pair) => [`${pair.adId}|${pair.accountId}`, pair])).values()];
  if (!uniquePairs.length) return NextResponse.json({});

  const tokenByAccount = await buildTokenByAccount(tokens);
  const groups = groupCreativeRequests(
    uniquePairs.map((pair) => pair.adId),
    uniquePairs.map((pair) => pair.accountId),
    tokenByAccount,
    tokens[0]
  );

  const results = await Promise.all(
    groups.map((group) => fetchCreativeAssets(group.adIds, group.accountIds, tokenByAccount, group.token))
  );

  return NextResponse.json(Object.assign({}, ...results));
}
