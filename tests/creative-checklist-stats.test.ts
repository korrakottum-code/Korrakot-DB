import assert from "node:assert/strict";
import test from "node:test";

import {
  percentile,
  computeDataDrivenThreshold,
  computeItemPassRates,
  findWeakItems,
} from "../lib/creative-checklist-stats.ts";

test("percentile returns nearest-rank value", () => {
  assert.equal(percentile([10, 20, 30, 40, 50], 20), 10);
  assert.equal(percentile([10, 20, 30, 40, 50], 100), 50);
  assert.equal(percentile([10, 20, 30, 40, 50], 50), 30);
  assert.equal(percentile([], 50), 0);
});

test("computeDataDrivenThreshold derives threshold from real Top ad scores instead of a fixed guess", () => {
  // Some real Top ads scored as low as 60%, so the threshold must adapt down
  // from a fixed 80 to reflect what Top ads actually achieve.
  const scores = [60, 65, 70, 75, 80, 85, 90, 95];
  const threshold = computeDataDrivenThreshold(scores, { percentileRank: 20, min: 50, max: 85, step: 5 });
  assert.ok(threshold <= 70, `expected threshold to drop toward real scores, got ${threshold}`);
  assert.ok(threshold >= 50);
});

test("computeDataDrivenThreshold clamps to min/max", () => {
  assert.equal(computeDataDrivenThreshold([10, 12, 15], { min: 50, max: 85, step: 5 }), 50);
  assert.equal(computeDataDrivenThreshold([95, 98, 99], { percentileRank: 100, min: 50, max: 85, step: 5 }), 85);
});

test("computeDataDrivenThreshold returns min for empty input", () => {
  assert.equal(computeDataDrivenThreshold([], { min: 55 }), 55);
});

test("computeItemPassRates aggregates pass/fail across ads", () => {
  const perAd = [
    [{ id: "a", met: true }, { id: "b", met: false }],
    [{ id: "a", met: true }, { id: "b", met: false }],
    [{ id: "a", met: false }, { id: "b", met: false }],
  ];
  const rates = computeItemPassRates(perAd);
  const byId = Object.fromEntries(rates.map((r) => [r.id, r]));
  assert.equal(byId.a.passCount, 2);
  assert.equal(byId.a.total, 3);
  assert.equal(byId.a.rate, 66.7);
  assert.equal(byId.b.rate, 0);
});

test("findWeakItems flags low pass-rate items with enough sample size", () => {
  const rates = [
    { id: "a", passCount: 1, total: 10, rate: 10 },
    { id: "b", passCount: 9, total: 10, rate: 90 },
    { id: "c", passCount: 0, total: 2, rate: 0 }, // below minSampleSize, excluded
  ];
  const weak = findWeakItems(rates, 30, 5);
  assert.equal(weak.length, 1);
  assert.equal(weak[0].id, "a");
});
