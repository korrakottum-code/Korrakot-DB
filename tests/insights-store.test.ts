import assert from "node:assert/strict";
import test from "node:test";

import {
  aggregateByAccountDate,
  aggregatesDiffer,
  collapseToRanges,
  splitDateRange,
  SETTLING_WINDOW_DAYS,
  type DailyMetricRow,
} from "../lib/insights-store.ts";

test("splitDateRange keeps everything within the settling window as recent", () => {
  const asOf = new Date("2026-08-07T10:00:00.000Z");
  const { finalDates, recentDates } = splitDateRange("2026-08-01", "2026-08-07", asOf);

  // asOf 2026-08-07, window 7 days → boundary 2026-07-31 → nothing in Aug is "final" yet
  assert.deepEqual(finalDates, []);
  assert.deepEqual(recentDates, [
    "2026-08-01", "2026-08-02", "2026-08-03", "2026-08-04",
    "2026-08-05", "2026-08-06", "2026-08-07",
  ]);
});

test("splitDateRange marks dates older than the settling window as final", () => {
  const asOf = new Date("2026-08-07T10:00:00.000Z");
  const { finalDates, recentDates } = splitDateRange("2026-07-01", "2026-08-07", asOf);

  assert.equal(finalDates[0], "2026-07-01");
  assert.equal(finalDates.at(-1), "2026-07-30");
  assert.equal(finalDates.length, 30);
  assert.equal(recentDates[0], "2026-07-31");
  assert.equal(recentDates.at(-1), "2026-08-07");
  assert.equal(recentDates.length, 8);
});

test("splitDateRange respects a custom settling window", () => {
  const asOf = new Date("2026-08-07T00:00:00.000Z");
  const { finalDates, recentDates } = splitDateRange("2026-08-01", "2026-08-07", asOf, 1);

  assert.deepEqual(finalDates, [
    "2026-08-01", "2026-08-02", "2026-08-03", "2026-08-04", "2026-08-05",
  ]);
  assert.deepEqual(recentDates, ["2026-08-06", "2026-08-07"]);
});

test("SETTLING_WINDOW_DAYS defaults to 7", () => {
  assert.equal(SETTLING_WINDOW_DAYS, 7);
});

test("collapseToRanges merges consecutive dates into one range", () => {
  const ranges = collapseToRanges(["2026-07-01", "2026-07-02", "2026-07-03"]);
  assert.deepEqual(ranges, [{ since: "2026-07-01", until: "2026-07-03" }]);
});

test("collapseToRanges splits on gaps", () => {
  const ranges = collapseToRanges(["2026-07-01", "2026-07-02", "2026-07-10", "2026-07-11", "2026-07-12"]);
  assert.deepEqual(ranges, [
    { since: "2026-07-01", until: "2026-07-02" },
    { since: "2026-07-10", until: "2026-07-12" },
  ]);
});

test("collapseToRanges handles a single date and an empty list", () => {
  assert.deepEqual(collapseToRanges(["2026-07-01"]), [{ since: "2026-07-01", until: "2026-07-01" }]);
  assert.deepEqual(collapseToRanges([]), []);
});

test("collapseToRanges keeps every date as its own range when nothing is consecutive", () => {
  const ranges = collapseToRanges(["2026-07-01", "2026-07-03", "2026-07-05"]);
  assert.deepEqual(ranges, [
    { since: "2026-07-01", until: "2026-07-01" },
    { since: "2026-07-03", until: "2026-07-03" },
    { since: "2026-07-05", until: "2026-07-05" },
  ]);
});

const metricRow = (accountId: string, date: string, values: Partial<DailyMetricRow> = {}): DailyMetricRow => ({
  accountId,
  adId: values.adId ?? "ad-1",
  date,
  spend: values.spend ?? 10,
  impressions: values.impressions ?? 100,
  clicks: values.clicks ?? 5,
  reach: values.reach ?? 80,
  inbox: values.inbox ?? 2,
  leads: values.leads ?? 1,
});

test("aggregateByAccountDate sums rows per (account, date) pair", () => {
  const map = aggregateByAccountDate([
    metricRow("act_1", "2026-08-01", { adId: "a", spend: 10, inbox: 2 }),
    metricRow("act_1", "2026-08-01", { adId: "b", spend: 5, inbox: 1 }),
    metricRow("act_1", "2026-08-02", { adId: "a", spend: 7 }),
    metricRow("act_2", "2026-08-01", { adId: "a", spend: 3 }),
  ]);
  assert.equal(map.size, 3);
  const day1 = map.get("act_1|2026-08-01")!;
  assert.equal(day1.rowCount, 2);
  assert.equal(day1.spend, 15);
  assert.equal(day1.inbox, 3);
  assert.equal(map.get("act_2|2026-08-01")!.spend, 3);
});

test("aggregatesDiffer treats missing side as zeros and tolerates float noise in spend", () => {
  const base = { rowCount: 1, spend: 10, impressions: 100, clicks: 5, reach: 80, inbox: 2, leads: 1 };
  assert.equal(aggregatesDiffer(base, { ...base }), false);
  assert.equal(aggregatesDiffer(base, { ...base, spend: 10.005 }), false);
  assert.equal(aggregatesDiffer(base, { ...base, spend: 10.5 }), true);
  assert.equal(aggregatesDiffer(base, { ...base, inbox: 3 }), true);
  assert.equal(aggregatesDiffer(base, { ...base, rowCount: 2 }), true);
  assert.equal(aggregatesDiffer(undefined, undefined), false);
  assert.equal(aggregatesDiffer(base, undefined), true);
});
