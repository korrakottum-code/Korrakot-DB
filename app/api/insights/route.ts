import { NextRequest, NextResponse } from "next/server";
import { fetchAllCampaignMetadata, fetchAllInsights } from "@/lib/meta";
import { dedupeAccounts, dedupeCampaigns, dedupeInsights } from "@/lib/dedupe";
import { getServerCache } from "@/lib/server-cache";
import { consumeApiRateLimit } from "@/lib/rate-limit";
import { validateDateQuery } from "@/lib/request-validation";
import { requireInternalApiAuth } from "@/lib/api-auth";
import { getBranchMap, getTestBranchCodes, getTestBranchNames } from "@/lib/parser";
import {
  aggregateDaily,
  calculatePacing,
  classifyDimension,
  confidenceForSample,
  getReportingPeriods,
  objectiveMetric,
  sumReportingRows,
} from "@/lib/reporting";
import { createSnapshotId } from "@/lib/report-export";

const CACHE_TTL_MS = 10 * 60 * 1000;
// หลัง cache หมดอายุ ยังเสิร์ฟข้อมูลเก่าได้อีก 1 ชม. ระหว่างรีเฟรชจาก Meta เบื้องหลัง
// — หน้าเว็บขึ้นทันทีเสมอ ไม่ต้องรอโหลดใหม่ทั้งชุด
const CACHE_STALE_TTL_MS = 60 * 60 * 1000;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
    const periods = getReportingPeriods(
      customSince && customUntil ? "custom" : datePreset as "today" | "yesterday" | "last_7d" | "last_30d" | "this_month" | "last_month",
      { since: customSince, until: customUntil }
    );
    const ranges = { current: periods.current, previous: periods.comparison };

    const cacheKey = [
      "insights",
      ranges.current.since,
      ranges.current.until,
      ranges.previous.since,
      ranges.previous.until,
    ].join(":");
    // ช่วงปัจจุบันกับช่วงเทียบต่อเนื่องกัน (ช่วงเทียบจบก่อนช่วงปัจจุบันเริ่ม 1 วัน)
    // → ดึงครั้งเดียวคลุมทั้งสองช่วงแล้วแยกแถวตามวันที่ ลดจำนวนคำขอ Meta ลงครึ่งหนึ่ง
    // ช่วงที่มีช่องว่าง (เช่น MTD เทียบเดือนก่อน) ยังต้องดึงแยกเพราะดึงคลุมจะได้วันส่วนเกินมาก
    const contiguousPeriods =
      new Date(`${ranges.current.since}T00:00:00Z`).getTime() -
        new Date(`${ranges.previous.until}T00:00:00Z`).getTime() ===
      86_400_000;

    const cached = await getServerCache(cacheKey, CACHE_TTL_MS, async () => {
      let currentResults: Awaited<ReturnType<typeof fetchAllInsights>>[];
      let prevResults: Awaited<ReturnType<typeof fetchAllInsights>>[];
      let campaignResults: Awaited<ReturnType<typeof fetchAllCampaignMetadata>>[];
      if (contiguousPeriods) {
        const [combinedResults, campaignData] = await Promise.all([
          Promise.all(tokens.map((token) => fetchAllInsights(token, undefined, ranges.previous.since, ranges.current.until))),
          Promise.all(tokens.map((token) => fetchAllCampaignMetadata(token))),
        ]);
        campaignResults = campaignData;
        const isPreviousRow = (date: string) => date !== "" && date <= ranges.previous.until;
        currentResults = combinedResults.map((r) => ({
          ...r,
          insights: r.insights.filter((row) => !isPreviousRow(row.date)),
        }));
        // failure ของการดึงรวมรายงานครั้งเดียวฝั่ง current เพื่อไม่ให้นับซ้ำสองช่วง
        prevResults = combinedResults.map((r) => ({
          ...r,
          insights: r.insights.filter((row) => isPreviousRow(row.date)),
          failures: [],
        }));
      } else {
        [currentResults, prevResults, campaignResults] = await Promise.all([
          Promise.all(tokens.map((token) => fetchAllInsights(token, undefined, ranges.current.since, ranges.current.until))),
          Promise.all(tokens.map((token) => fetchAllInsights(token, undefined, ranges.previous.since, ranges.previous.until))),
          Promise.all(tokens.map((token) => fetchAllCampaignMetadata(token))),
        ]);
      }

      const rawInsights = dedupeInsights(currentResults.flatMap((r) => r.insights));
      const spendByCampaign = new Map<string, number>();
      for (const row of rawInsights) {
        const key = `${row.accountId}|${row.campaignId || ""}`;
        spendByCampaign.set(key, (spendByCampaign.get(key) || 0) + row.spend);
      }
      const campaigns = dedupeCampaigns(campaignResults.flatMap((r) => r.campaigns)).map((campaign) => ({
        ...campaign,
        spent: spendByCampaign.get(`${campaign.accountId}|${campaign.campaignId}`) || 0,
      }));
      const adSetGoals = new Map<string, string>();
      for (const result of campaignResults) {
        for (const [adSetId, goal] of Object.entries(result.adSetGoals)) {
          adSetGoals.set(adSetId, goal);
        }
      }
      const campaignMap = new Map(campaigns.map((campaign) => [`${campaign.accountId}|${campaign.campaignId}`, campaign]));
      const enrich = (rows: typeof currentResults[number]["insights"]) => rows.map((row) => {
        const campaign = campaignMap.get(`${row.accountId}|${row.campaignId || ""}`);
        return campaign
          ? {
              ...row,
              objective: campaign.objective || undefined,
              optimizationGoal: campaign.optimizationGoal || (row.adSetId ? adSetGoals.get(row.adSetId) : undefined),
              status: campaign.status || undefined,
              effectiveStatus: campaign.effectiveStatus || undefined,
              budget: campaign.budget,
              budgetType: campaign.budgetType,
              budgetRemaining: campaign.budgetRemaining ?? undefined,
            }
          : row;
      });
      const insights = dedupeInsights(enrich(rawInsights));
      const previousInsights = dedupeInsights(prevResults.flatMap((r) => r.insights));
      const accounts = dedupeAccounts(currentResults.flatMap((r) => r.accounts));
      const failures = [
        ...currentResults.flatMap((r, tokenIndex) =>
          r.failures.map((failure) => ({ ...failure, tokenIndex: tokenIndex + 1, period: "current" }))
        ),
        ...prevResults.flatMap((r, tokenIndex) =>
          r.failures.map((failure) => ({ ...failure, tokenIndex: tokenIndex + 1, period: "previous" }))
        ),
        ...campaignResults.flatMap((r, tokenIndex) =>
          r.failures.map((failure) => ({ ...failure, tokenIndex: tokenIndex + 1, period: "current" }))
        ),
      ];

      return { insights, previousInsights, campaigns, accounts, failures };
    }, forceRefresh, { staleTtlMs: CACHE_STALE_TTL_MS });

    const rows = cached.value.insights;
    const totals = sumReportingRows(rows);
    const previousTotals = sumReportingRows(cached.value.previousInsights);
    const knownBranchCodes = new Set(Object.keys(getBranchMap()));
    const testBranchCodes = getTestBranchCodes();
    const testBranchNames = getTestBranchNames();
    const dimensions = rows.map((row) => classifyDimension(row.parsed, { knownBranchCodes, testBranchCodes, testBranchNames }));
    const dimensionCounts = dimensions.reduce<Record<string, number>>((result, dimension) => {
      result[dimension] = (result[dimension] || 0) + 1;
      return result;
    }, {});
    const objectiveGroups = new Map<string, typeof rows>();
    for (const row of rows) {
      const objective = row.objective || "UNKNOWN";
      const optimizationGoal = row.optimizationGoal || "UNKNOWN";
      const groupKey = `${objective}|${optimizationGoal}`;
      const group = objectiveGroups.get(groupKey) || [];
      group.push(row);
      objectiveGroups.set(groupKey, group);
    }
    const objectiveBreakdown = [...objectiveGroups.entries()].map(([groupKey, group]) => {
      const [objective, optimizationGoal] = groupKey.split("|");
      const metric = objectiveMetric(objective, optimizationGoal);
      const groupTotals = sumReportingRows(group);
      const sample = metric.key === "unknown" ? 0 : groupTotals[metric.key];
      return { objective, optimizationGoal: optimizationGoal === "UNKNOWN" ? undefined : optimizationGoal, metric, totals: groupTotals, confidence: confidenceForSample(sample, metric.key === "impressions" ? groupTotals.impressions : sample, groupTotals.spend > 0) };
    });
    const failureAccountIds = new Set(cached.value.failures.filter((failure) => failure.accountId).map((failure) => failure.accountId));
    const dailyBudget = cached.value.campaigns
      .filter((campaign) => campaign.budgetType === "daily")
      .reduce((sum, campaign) => sum + campaign.budget, 0);
    const lifetimeBudget = cached.value.campaigns
      .filter((campaign) => campaign.budgetType === "lifetime")
      .reduce((sum, campaign) => sum + campaign.budget, 0);
    const pacing = {
      daily: calculatePacing({
        spent: totals.spend,
        budget: dailyBudget,
        budgetType: "daily",
        daysElapsed: periods.current.elapsedDays,
        totalDays: periods.current.days,
      }),
      lifetime: calculatePacing({
        spent: totals.spend,
        budget: lifetimeBudget,
        budgetType: "lifetime",
        daysElapsed: periods.current.elapsedDays,
        totalDays: periods.current.days,
      }),
      note: periods.current.isPartial ? "ช่วงเวลาปัจจุบันยังไม่จบ ควรอ่าน Pacing คู่กับ As-of" : "คำนวณจาก Budget ที่ Meta ส่งมา",
    };
    const statusMap = new Map<string, { objective: string; status: string; effectiveStatus: string; campaigns: number; spend: number; budget: number }>();
    for (const campaign of cached.value.campaigns) {
      const objective = campaign.objective || "UNKNOWN";
      const status = campaign.status || "UNKNOWN";
      const effectiveStatus = campaign.effectiveStatus || "UNKNOWN";
      const key = `${objective}|${status}|${effectiveStatus}`;
      const item = statusMap.get(key) || {
        objective,
        status,
        effectiveStatus,
        campaigns: 0,
        spend: 0,
        budget: 0,
      };
      item.campaigns += 1;
      item.spend += campaign.spent;
      item.budget += campaign.budget;
      statusMap.set(key, item);
    }
    const statusBreakdown = [...statusMap.values()];
    const coverage = {
      accountsTotal: cached.value.accounts.length,
      accountsWithFailures: failureAccountIds.size,
      accountsComplete: Math.max(0, cached.value.accounts.length - failureAccountIds.size),
      rows: rows.length,
      parsedRows: dimensions.filter((dimension) => dimension !== "unknown").length,
      unknownRows: dimensions.filter((dimension) => dimension === "unknown").length,
      failureCount: cached.value.failures.length,
      complete: cached.value.failures.length === 0,
    };

    return NextResponse.json({
      ...cached.value,
      asOf: periods.asOf,
      timezone: periods.timezone,
      generatedAt: new Date().toISOString(),
      snapshotId: createSnapshotId({
        since: periods.current.since,
        until: periods.current.until,
        comparisonSince: periods.comparison.since,
        comparisonUntil: periods.comparison.until,
        fetchedAt: cached.fetchedAt,
      }),
      periods,
      totals,
      previousTotals,
      dailySeries: aggregateDaily(rows),
      previousDailySeries: aggregateDaily(cached.value.previousInsights),
      objectiveBreakdown,
      classification: { counts: dimensionCounts, knownBranchCodes: knownBranchCodes.size },
      statusBreakdown,
      pacing,
      coverage,
      cache: { hit: cached.hit, fetchedAt: cached.fetchedAt, asOf: periods.asOf, stale: cached.stale === true },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
