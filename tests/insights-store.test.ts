import assert from "node:assert/strict";
import test from "node:test";

import { collapseToRanges, splitDateRange, SETTLING_WINDOW_DAYS } from "../lib/insights-store.ts";

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
