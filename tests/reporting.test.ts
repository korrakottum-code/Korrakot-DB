import assert from "node:assert/strict";
import test from "node:test";

import {
  aggregateDaily,
  calculatePacing,
  classifyDimension,
  confidenceForSample,
  getReportingPeriods,
  objectiveMetric,
  sumReportingRows,
} from "../lib/reporting.ts";

const row = (date: string, values: Partial<{ spend: number; impressions: number; reach: number; clicks: number; inbox: number; leads: number }> = {}) => ({
  adName: "KKC PBF0-0454",
  parsed: { branch: "กังสดาล", branchCode: "KKC", isParsed: true } as never,
  spend: values.spend ?? 10,
  impressions: values.impressions ?? 100,
  reach: values.reach ?? 80,
  clicks: values.clicks ?? 10,
  inbox: values.inbox ?? 2,
  leads: values.leads ?? 1,
  ctr: 10,
  cpc: 1,
  cpm: 100,
  cpi: 5,
  cpl: 10,
  date,
  accountId: "act_1",
  accountName: "Main",
  adId: `ad-${date}`,
});

test("reporting periods use equal-length comparisons and MTD", () => {
  const now = new Date("2026-07-11T10:00:00.000Z");
  const last7 = getReportingPeriods("last_7d", { now });
  assert.equal(last7.current.days, 7);
  assert.equal(last7.comparison.days, 7);
  assert.equal(last7.comparisonFair, true);

  const mtd = getReportingPeriods("this_month", { now });
  assert.equal(mtd.current.since, "2026-07-01");
  assert.equal(mtd.current.until, "2026-07-11");
  assert.equal(mtd.comparison.since, "2026-06-01");
  assert.equal(mtd.comparison.until, "2026-06-11");
  assert.equal(mtd.comparisonMode, "month_to_date");
});

test("today is marked partial and includes pacing note", () => {
  const periods = getReportingPeriods("today", { now: new Date("2026-07-11T10:00:00.000Z") });
  assert.equal(periods.current.isPartial, true);
  assert.equal(periods.comparisonMode, "partial_period_with_pacing");
  assert.ok(periods.current.elapsedDays > 0 && periods.current.elapsedDays < 1);
  assert.ok(periods.notes.some((note) => note.includes("Pacing")));
});

test("daily aggregation recomputes rates from totals", () => {
  const daily = aggregateDaily([
    row("2026-07-10", { spend: 10, impressions: 100, clicks: 10, inbox: 2, leads: 1 }),
    row("2026-07-10", { spend: 20, impressions: 300, clicks: 30, inbox: 4, leads: 2 }),
    row("2026-07-11", { spend: 5, impressions: 50, clicks: 5, inbox: 1, leads: 1 }),
  ]);
  assert.equal(daily.length, 2);
  assert.equal(daily[0].spend, 30);
  assert.equal(daily[0].ctr, 40 / 400);
  assert.equal(daily[0].cpi, 5);
  assert.equal(daily[1].cpl, 5);
});

test("objective mapping prevents mixing inbox with other objectives", () => {
  assert.equal(objectiveMetric("OUTCOME_LEADS").key, "leads");
  assert.equal(objectiveMetric("MESSAGES").costLabel, "CPI");
  assert.equal(objectiveMetric("TRAFFIC").costLabel, "CPC");
  assert.equal(objectiveMetric("AWARENESS").costLabel, "CPM");
  assert.equal(objectiveMetric("UNKNOWN").key, "unknown");
});

test("classification separates Class Go, non-sales, test, and unknown", () => {
  const base = { branch: "Class Go กัง", branchCode: "KKG", isParsed: true } as const;
  assert.equal(classifyDimension(base), "class_go");
  assert.equal(classifyDimension({ branch: "หน้าบ้าน", branchCode: "HB", isParsed: true }), "special");
  assert.equal(classifyDimension({ branch: "ทรัพยากรบุคคล", branchCode: "HR", isParsed: true }), "non_sales");
  assert.equal(classifyDimension(base, { testBranchCodes: new Set(["KKG"]) }), "test");
  assert.equal(classifyDimension({ branch: "ไม่รู้จัก", branchCode: "ZZZ", isParsed: true }, { knownBranchCodes: new Set(["KKC"]) }), "unknown");
});

test("confidence and pacing expose low sample and budget status", () => {
  assert.equal(confidenceForSample(1).level, "Low");
  assert.equal(confidenceForSample(15, 200).level, "Medium");
  assert.equal(confidenceForSample(35, 200).level, "High");

  const over = calculatePacing({ spent: 800, budget: 1_000, budgetType: "lifetime", daysElapsed: 5, totalDays: 10 });
  assert.equal(over.status, "over_pace");
  assert.equal(over.progress, 0.8);
  assert.equal(calculatePacing({ spent: 10, budget: 0, budgetType: "daily", daysElapsed: 1, totalDays: 1 }).status, "not_available");
});

test("totals return null for rates with zero denominators", () => {
  const totals = sumReportingRows([{ spend: 20, impressions: 0, reach: 0, clicks: 0, inbox: 0, leads: 0 }]);
  assert.equal(totals.ctr, null);
  assert.equal(totals.cpc, null);
  assert.equal(totals.cpi, null);
  assert.equal(totals.cpl, null);
});
