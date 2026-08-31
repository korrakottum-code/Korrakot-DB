import assert from "node:assert/strict";
import test from "node:test";

import { aggregateBranchMetrics } from "../lib/branch-metrics.ts";
import type { ParsedAdName } from "../lib/parser.ts";

const parsed = (branchCode: string, branch: string, isParsed = true) =>
  ({ branchCode, branch, isParsed } as ParsedAdName);

const row = (
  branchCode: string,
  branch: string,
  values: Partial<{ spend: number; impressions: number; reach: number; clicks: number; inbox: number; leads: number }> = {},
  isParsed = true
) => ({
  parsed: parsed(branchCode, branch, isParsed),
  spend: values.spend ?? 100,
  impressions: values.impressions ?? 1000,
  reach: values.reach ?? 800,
  clicks: values.clicks ?? 50,
  inbox: values.inbox ?? 10,
  leads: values.leads ?? 4,
});

const branchMap = {
  NMA: "โคราช",
  UDN: "อุดร",
  KKG: "Class Go กัง",
  CLS: "เพจหลัก",
  HR: "ทรัพยากรบุคคล",
  TST: "สาขาทดสอบ",
};

test("รวมยอดต่อสาขา และคำนวณ CPI/CPL ให้", () => {
  const result = aggregateBranchMetrics(
    [
      row("NMA", "โคราช", { spend: 300, inbox: 30, leads: 10 }),
      row("NMA", "โคราช", { spend: 100, inbox: 10, leads: 0 }),
      row("UDN", "อุดร", { spend: 200, inbox: 8, leads: 4 }),
    ],
    { branchMap }
  );

  assert.equal(result.branches.length, 2);
  const nma = result.branches[0];
  assert.equal(nma.code, "NMA");
  assert.equal(nma.name, "โคราช");
  assert.equal(nma.spend, 400);
  assert.equal(nma.inbox, 40);
  assert.equal(nma.cpi, 10);      // 400 / 40
  assert.equal(nma.cpl, 40);      // 400 / 10
  assert.equal(result.totals.spend, 600);
});

test("เรียงจาก spend มากไปน้อย", () => {
  const result = aggregateBranchMetrics(
    [row("UDN", "อุดร", { spend: 50 }), row("NMA", "โคราช", { spend: 900 })],
    { branchMap }
  );
  assert.deepEqual(result.branches.map((b) => b.code), ["NMA", "UDN"]);
});

test("Class Go นับเป็นสาขาขาย แต่แยก dimension ไว้", () => {
  const result = aggregateBranchMetrics([row("KKG", "Class Go กัง", { spend: 120 })], { branchMap });
  assert.equal(result.branches.length, 1);
  assert.equal(result.branches[0].dimension, "class_go");
  assert.equal(result.totals.spend, 120);
});

test("เพจหลัก / HR / สาขาทดสอบ / พาร์สไม่ออก ไม่ถูกนับเป็นสาขา แต่รายงานใน excluded", () => {
  const result = aggregateBranchMetrics(
    [
      row("NMA", "โคราช", { spend: 100 }),
      row("CLS", "เพจหลัก", { spend: 70 }),
      row("HR", "ทรัพยากรบุคคล", { spend: 30 }),
      row("TST", "สาขาทดสอบ", { spend: 25 }),
      row("", "", { spend: 5 }, false),
    ],
    { branchMap, testBranchCodes: new Set(["TST"]), testBranchNames: new Set(["สาขาทดสอบ"]) }
  );

  assert.deepEqual(result.branches.map((b) => b.code), ["NMA"]);
  assert.equal(result.totals.spend, 100, "totals ต้องนับเฉพาะสาขาขาย");

  const byDimension = Object.fromEntries(result.excluded.map((e) => [e.dimension, e.spend]));
  assert.equal(byDimension.special, 70);
  assert.equal(byDimension.non_sales, 30);
  assert.equal(byDimension.test, 25);
  assert.equal(byDimension.unknown, 5);
});

test("กองที่ถูกกันออกต้องรายงาน inbox/leads ครบ ไม่ใช่แค่งบ", () => {
  const result = aggregateBranchMetrics(
    [
      row("NMA", "โคราช", { spend: 100, inbox: 10, leads: 4 }),
      row("CLS", "เพจหลัก", { spend: 70, impressions: 5000, reach: 4000, clicks: 250, inbox: 35, leads: 7 }),
      row("CLS", "เพจหลัก", { spend: 30, impressions: 1000, reach: 800, clicks: 50, inbox: 15, leads: 3 }),
    ],
    { branchMap }
  );

  const special = result.excluded.find((e) => e.dimension === "special");
  assert.ok(special, "ต้องมีกอง special");
  assert.equal(special.ads, 2, "นับจำนวนโฆษณาเหมือนเดิม");
  assert.equal(special.spend, 100, "งบยังปัดเป็นบาทเต็มเหมือนเดิม");
  assert.equal(special.inbox, 50, "ต้องรวม inbox ให้ด้วย");
  assert.equal(special.leads, 10);
  assert.equal(special.impressions, 6000);
  assert.equal(special.reach, 4800);
  assert.equal(special.clicks, 300);
  assert.equal(special.cpi, 2, "ต้นทุนต่อคนทัก = 100 / 50");
  assert.equal(special.cpl, 10);

  assert.equal(result.totals.spend, 100, "totals ยังนับเฉพาะสาขาขาย ไม่เปลี่ยน");
  assert.equal(result.totals.inbox, 10);
});

test("กองที่ถูกกันออกไม่มี inbox เลย ต้องไม่หาร 0", () => {
  const result = aggregateBranchMetrics(
    [row("HR", "ทรัพยากรบุคคล", { spend: 60, inbox: 0, leads: 0 })],
    { branchMap }
  );
  const hr = result.excluded.find((e) => e.dimension === "non_sales");
  assert.ok(hr);
  assert.equal(hr.inbox, 0);
  assert.equal(hr.cpi, null, "ไม่มีคนทัก ต้องเป็น null ไม่ใช่ Infinity");
  assert.equal(hr.cpl, null);
});

test("รหัสสาขาที่ไม่มีใน branch map ถือว่า unknown ไม่ปนกับสาขาจริง", () => {
  const result = aggregateBranchMetrics([row("ZZZ", "ไม่รู้จัก", { spend: 40 })], { branchMap });
  assert.equal(result.branches.length, 0);
  assert.equal(result.excluded[0].dimension, "unknown");
  assert.equal(result.excluded[0].spend, 40);
});

test("ไม่มีข้อมูลก็ต้องไม่พัง", () => {
  const result = aggregateBranchMetrics([], { branchMap });
  assert.deepEqual(result.branches, []);
  assert.equal(result.totals.spend, 0);
  assert.equal(result.totals.cpi, null);
  assert.deepEqual(result.excluded, []);
});
