import { NextRequest, NextResponse } from "next/server";
import { fetchAccounts, fetchAllCampaignMetadata, type AdAccount, type AdInsight } from "@/lib/meta";
import { dedupeAccounts, dedupeCampaigns, dedupeInsights } from "@/lib/dedupe";
import { getServerCache } from "@/lib/server-cache";
import { consumeApiRateLimit } from "@/lib/rate-limit";
import { validateDateQuery } from "@/lib/request-validation";
import { requireInternalApiAuth } from "@/lib/api-auth";
import { getBranchMap, getTestBranchCodes, getTestBranchNames, parseAdName } from "@/lib/parser";
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
import { readInsightRows } from "@/lib/insights-store";
import { ensureDailyAdNameSweep, syncRange } from "@/lib/insights-sync";

const CACHE_TTL_MS = 10 * 60 * 1000;
// หลัง cache หมดอายุ ยังเสิร์ฟข้อมูลเก่าได้อีก 1 ชม. ระหว่างรีเฟรชจาก Meta เบื้องหลัง
// — หน้าเว็บขึ้นทันทีเสมอ ไม่ต้องรอโหลดใหม่ทั้งชุด
const CACHE_STALE_TTL_MS = 60 * 60 * 1000;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function toAdInsight(row: Awaited<ReturnType<typeof readInsightRows>>[number], accountName: string): AdInsight {
  const parsed = parseAdName(row.adName);
  return {
    adName: row.adName,
    parsed,
    spend: row.spend,
    impressions: row.impressions,
    clicks: row.clicks,
    reach: row.reach,
    ctr: 0,
    cpc: 0,
    cpm: 0,
    inbox: row.inbox,
    cpi: row.inbox > 0 ? row.spend / row.inbox : 0,
    leads: row.leads,
    cpl: row.leads > 0 ? row.spend / row.leads : 0,
    date: row.date,
    accountId: row.accountId,
    accountName,
    adId: row.adId,
    campaignId: row.campaignId,
    adSetId: row.adSetId,
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
    const periods = getReportingPeriods(
      customSince && customUntil ? "custom" : datePreset as "today" | "yesterday" | "last_7d" | "last_30d" | "this_month" | "last_month",
      { since: customSince, until: customUntil }
    );
    const ranges = { current: periods.current, previous: periods.comparison };
    const asOf = new Date(periods.asOf);

    // รายชื่อบัญชีโฆษณาต่อ token — ถูกและไม่ผูกกับช่วงวันที่ cache ร่วมกันทุก preset
    const accountResults = await Promise.all(
      tokens.map((token, tokenIndex) =>
        getServerCache(`accounts:${tokenIndex}`, CACHE_TTL_MS, () => fetchAccounts(token))
      )
    );
    const accounts = dedupeAccounts(accountResults.flatMap((r) => r.value.accounts));
    const accountIds = accounts.map((a) => a.id);
    const accountNameById = new Map<string, string>(accounts.map((a: AdAccount) => [a.id, a.name]));
    const accountFailures = accountResults.flatMap((r, tokenIndex) =>
      r.value.failures.map((failure) => ({ ...failure, tokenIndex: tokenIndex + 1, period: "current" as const }))
    );

    const cacheKey = [
      "insights",
      ranges.current.since,
      ranges.current.until,
      ranges.previous.since,
      ranges.previous.until,
    ].join(":");

    const cached = await getServerCache(cacheKey, CACHE_TTL_MS, async () => {
      // กวาดชื่อแอดทั้งบัญชี (จับ rename ของแอดเก่า) วันละครั้ง — จังหวะจากตาราง sync_meta
      const sweepFailures = await ensureDailyAdNameSweep(tokens);

      // sync ทั้งสองช่วงพร้อมกัน: วันที่ final ที่ขาด + ช่วง recent ที่หมดอายุความสดเท่านั้น
      // (ปกติหลัง sync รอบแรกของวัน ทั้งคู่เป็น no-op → เหลือแค่อ่าน Postgres)
      // campaign metadata ไม่ผูกช่วงวันที่ — cache แยกต่อ token ใช้ร่วมกันทุก preset
      const [currentSyncFailures, prevSyncFailures, campaignResults] = await Promise.all([
        Promise.all(tokens.map((token) => syncRange(token, accountIds, ranges.current.since, ranges.current.until, asOf, forceRefresh))),
        Promise.all(tokens.map((token) => syncRange(token, accountIds, ranges.previous.since, ranges.previous.until, asOf, forceRefresh))),
        Promise.all(tokens.map((token, tokenIndex) =>
          getServerCache(`campaigns:${tokenIndex}`, CACHE_TTL_MS, () => fetchAllCampaignMetadata(token), forceRefresh, { staleTtlMs: CACHE_STALE_TTL_MS }).then((r) => r.value)
        )),
      ]);

      // อ่านครั้งเดียวต่อช่วง (ไม่ใช่ต่อ token) — ข้อมูลใน DB รวมของทุก token อยู่แล้ว
      const [currentStored, previousStored] = await Promise.all([
        readInsightRows(accountIds, ranges.current.since, ranges.current.until),
        readInsightRows(accountIds, ranges.previous.since, ranges.previous.until),
      ]);

      const rawInsights = dedupeInsights(
        currentStored.map((row) => toAdInsight(row, accountNameById.get(row.accountId) || row.accountId))
      );
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
      const enrich = (rows: AdInsight[]) => rows.map((row) => {
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
      const previousInsights = dedupeInsights(
        previousStored.map((row) => toAdInsight(row, accountNameById.get(row.accountId) || row.accountId))
      );
      const failures = [
        ...sweepFailures.map((failure) => ({ ...failure, tokenIndex: 0, period: "current" as const })),
        ...currentSyncFailures.flatMap((tokenFailures, tokenIndex) =>
          tokenFailures.map((failure) => ({ ...failure, tokenIndex: tokenIndex + 1, period: "current" as const }))
        ),
        ...prevSyncFailures.flatMap((tokenFailures, tokenIndex) =>
          tokenFailures.map((failure) => ({ ...failure, tokenIndex: tokenIndex + 1, period: "previous" as const }))
        ),
        ...campaignResults.flatMap((r, tokenIndex) =>
          r.failures.map((failure) => ({ ...failure, tokenIndex: tokenIndex + 1, period: "current" as const }))
        ),
      ];

      return { insights, previousInsights, campaigns, accounts, failures };
    }, forceRefresh, { staleTtlMs: CACHE_STALE_TTL_MS });

    const rows = cached.value.insights;
    const allFailures = [...accountFailures, ...cached.value.failures];
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
    const failureAccountIds = new Set(allFailures.filter((failure) => failure.accountId).map((failure) => failure.accountId));
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
      failureCount: allFailures.length,
      complete: allFailures.length === 0,
    };

    return NextResponse.json({
      ...cached.value,
      failures: allFailures,
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
