import assert from "node:assert/strict";
import test from "node:test";

import {
  percentile,
  computeDataDrivenThreshold,
  computeSeparationThreshold,
  computeItemPassRates,
  computeItemLifts,
  findNonDiscriminativeItems,
  computeWeightUpdatesFromLifts,
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

test("computeSeparationThreshold picks the cut that best separates Top from Bottom scores", () => {
  // Top กระจุกอยู่สูง Bottom กระจุกอยู่ต่ำ → เกณฑ์ควรอยู่ตรงกลางระหว่างสองกลุ่ม
  const top = [70, 75, 80, 85, 90, 95];
  const bottom = [30, 35, 40, 45, 50, 55];
  const threshold = computeSeparationThreshold(top, bottom, { min: 50, max: 85, step: 5 });
  assert.ok(threshold >= 60 && threshold <= 70, `expected mid-gap threshold, got ${threshold}`);
});

test("computeSeparationThreshold does NOT just drop to let low-scoring Top ads pass", () => {
  // ทั้งสองกลุ่มคะแนนพอๆ กัน (checklist แยกไม่ออก) — เกณฑ์ต้องไม่ดิ่งลง min เพื่อเอาใจ Top
  const top = [55, 60, 60, 65, 70];
  const bottom = [50, 55, 60, 60, 65];
  const threshold = computeSeparationThreshold(top, bottom, { min: 50, max: 85, step: 5 });
  // percentile-20 แบบเดิมจะให้ 55 เสมอ แต่ separation จะเลือกจุดที่กัน bottom ได้บ้าง
  assert.ok(threshold >= 55, `expected threshold not to collapse below the overlap, got ${threshold}`);
});

test("computeSeparationThreshold falls back to percentile method when bottom sample is too small", () => {
  const top = [60, 65, 70, 75, 80];
  const fallback = computeSeparationThreshold(top, [40], { min: 50, max: 85, step: 5, minBottomSample: 5 });
  assert.equal(fallback, computeDataDrivenThreshold(top, { min: 50, max: 85, step: 5 }));
});

test("computeSeparationThreshold returns min for empty top scores", () => {
  assert.equal(computeSeparationThreshold([], [10, 20, 30, 40, 50], { min: 55 }), 55);
});

test("computeItemLifts compares per-item pass rates between Top and Bottom groups", () => {
  const topRates = [
    { id: "logo", passCount: 9, total: 10, rate: 90 },
    { id: "price", passCount: 8, total: 10, rate: 80 },
  ];
  const bottomRates = [
    { id: "logo", passCount: 9, total: 10, rate: 90 }, // ใครๆ ก็มีโลโก้ → lift 0
    { id: "price", passCount: 3, total: 10, rate: 30 }, // แอดดีมีราคาชัดมากกว่า → lift 50
  ];
  const lifts = computeItemLifts(topRates, bottomRates);
  const byId = Object.fromEntries(lifts.map((l) => [l.id, l]));
  assert.equal(byId.logo.lift, 0);
  assert.equal(byId.price.lift, 50);
});

test("findNonDiscriminativeItems flags items where Top ads do no better than Bottom ads", () => {
  const lifts = [
    { id: "logo", topRate: 90, bottomRate: 90, lift: 0, topTotal: 10, bottomTotal: 10 },
    { id: "price", topRate: 80, bottomRate: 30, lift: 50, topTotal: 10, bottomTotal: 10 },
    { id: "rare", topRate: 20, bottomRate: 20, lift: 0, topTotal: 3, bottomTotal: 3 }, // sample เล็กไป
  ];
  const flagged = findNonDiscriminativeItems(lifts, 10, 5);
  assert.equal(flagged.length, 1);
  assert.equal(flagged[0].id, "logo");
});

test("computeWeightUpdatesFromLifts boosts weight only for items that discriminate", () => {
  const lifts = [
    { id: "logo", topRate: 90, bottomRate: 90, lift: 0, topTotal: 10, bottomTotal: 10 },
    { id: "price", topRate: 80, bottomRate: 30, lift: 50, topTotal: 10, bottomTotal: 10 },
    { id: "rare", topRate: 80, bottomRate: 10, lift: 70, topTotal: 2, bottomTotal: 2 },
  ];
  const updates = computeWeightUpdatesFromLifts(lifts, 5);
  assert.equal(updates.get("logo"), 1);
  assert.equal(updates.get("price"), 2);
  assert.equal(updates.has("rare"), false);
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
