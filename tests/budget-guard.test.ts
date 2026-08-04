import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyBudgetWaste,
  flagWastefulCreatives,
  excessSpend,
  KILL_NO_RESULT_SPEND,
  WARN_NO_RESULT_SPEND,
  KILL_CPI,
} from "../lib/budget-guard.ts";
import { CPI_TARGET } from "../lib/management-rules.ts";

const messaging = { effectiveStatus: "ACTIVE", objective: "OUTCOME_ENGAGEMENT", optimizationGoal: "CONVERSATIONS" };

test("flags kill when spend hits threshold with zero inbox", () => {
  const flag = classifyBudgetWaste({ ...messaging, spent: KILL_NO_RESULT_SPEND, inbox: 0, cpi: 0 });
  assert.equal(flag?.level, "kill");
});

test("flags warning when spend is halfway with zero inbox", () => {
  const flag = classifyBudgetWaste({ ...messaging, spent: WARN_NO_RESULT_SPEND, inbox: 0, cpi: 0 });
  assert.equal(flag?.level, "warning");
});

test("does not flag low spend with zero inbox (still a fair test)", () => {
  assert.equal(classifyBudgetWaste({ ...messaging, spent: 50, inbox: 0, cpi: 0 }), null);
});

test("flags kill when CPI is more than double target with enough inbox", () => {
  const flag = classifyBudgetWaste({ ...messaging, spent: 900, inbox: 4, cpi: KILL_CPI + 25 });
  assert.equal(flag?.level, "kill");
});

test("flags warning when CPI is above target but under double", () => {
  const flag = classifyBudgetWaste({ ...messaging, spent: 450, inbox: 3, cpi: CPI_TARGET + 50 });
  assert.equal(flag?.level, "warning");
});

test("does not judge CPI with too few inbox", () => {
  // inbox แค่ 1-2 ตัว CPI ยังผันผวนเกินกว่าจะตัดสิน
  assert.equal(classifyBudgetWaste({ ...messaging, spent: 500, inbox: 2, cpi: 250 }), null);
});

test("does not flag campaigns that meet target", () => {
  assert.equal(classifyBudgetWaste({ ...messaging, spent: 800, inbox: 10, cpi: 80 }), null);
});

test("ignores paused campaigns", () => {
  assert.equal(
    classifyBudgetWaste({ ...messaging, effectiveStatus: "PAUSED", spent: 5000, inbox: 0, cpi: 0 }),
    null
  );
});

test("ignores non-inbox campaigns (lead / traffic)", () => {
  assert.equal(
    classifyBudgetWaste({ effectiveStatus: "ACTIVE", objective: "OUTCOME_LEADS", spent: 5000, inbox: 0, cpi: 0 }),
    null
  );
  assert.equal(
    classifyBudgetWaste({ effectiveStatus: "ACTIVE", objective: "OUTCOME_TRAFFIC", spent: 5000, inbox: 0, cpi: 0 }),
    null
  );
});

/* ── flagWastefulCreatives: รายชิ้นครีเอทีฟ ── */

const row = (over: Partial<Parameters<typeof flagWastefulCreatives>[0][number]> & { aw: string; cid: string }) => ({
  parsed: { creativeId: over.cid, awCode: `${over.aw}-01`, branch: "สาขาทดสอบ" },
  adId: over.adId ?? `${over.aw}-${over.cid}-ad`,
  spend: over.spend ?? 0,
  inbox: over.inbox ?? 0,
  effectiveStatus: over.effectiveStatus ?? "ACTIVE",
  objective: over.objective ?? "OUTCOME_ENGAGEMENT",
  optimizationGoal: over.optimizationGoal ?? "CONVERSATIONS",
});

test("flagWastefulCreatives groups rows into creative pieces and flags burners", () => {
  const flags = flagWastefulCreatives([
    // ชิ้นเดียวกัน กระจายหลายแถว/หลายวัน — รวมกันแล้วเผาเงิน
    row({ aw: "PF00", cid: "0292", spend: 200, inbox: 0, adId: "a1" }),
    row({ aw: "PF00", cid: "0292", spend: 150, inbox: 0, adId: "a2" }),
    // ชิ้นที่ทำผลงานดี — ต้องไม่ถูกธง
    row({ aw: "PM01", cid: "0273", spend: 500, inbox: 10, adId: "a3" }),
  ]);
  assert.equal(flags.length, 1);
  assert.equal(flags[0].groupKey, "PF00-0292");
  assert.equal(flags[0].flag.level, "kill");
  assert.equal(flags[0].spend, 350);
  assert.equal(flags[0].adCount, 2);
});

test("flagWastefulCreatives sorts critical pieces before warnings", () => {
  const flags = flagWastefulCreatives([
    row({ aw: "PW05", cid: "0100", spend: WARN_NO_RESULT_SPEND, inbox: 0 }), // warning
    row({ aw: "PF00", cid: "0200", spend: KILL_NO_RESULT_SPEND, inbox: 0 }), // kill
  ]);
  assert.equal(flags[0].flag.level, "kill");
  assert.equal(flags[0].groupKey, "PF00-0200");
  assert.equal(flags[1].flag.level, "warning");
});

test("flagWastefulCreatives skips pieces with no ACTIVE campaign left", () => {
  const flags = flagWastefulCreatives([
    row({ aw: "PF00", cid: "0292", spend: 900, inbox: 0, effectiveStatus: "PAUSED" }),
  ]);
  assert.equal(flags.length, 0);
});

test("flagWastefulCreatives ignores non-inbox rows and rows without creativeId", () => {
  const leadRow = row({ aw: "PF00", cid: "0292", spend: 900, inbox: 0, objective: "OUTCOME_LEADS", optimizationGoal: "LEAD_GENERATION" });
  const noCid = { ...row({ aw: "PF00", cid: "0293", spend: 900, inbox: 0 }), parsed: { creativeId: "", awCode: "PF00-01" } };
  assert.equal(flagWastefulCreatives([leadRow, noCid]).length, 0);
});

test("excessSpend measures spend beyond what target CPI justifies", () => {
  assert.equal(excessSpend({ spent: 500, inbox: 2 }), 500 - 2 * CPI_TARGET);
  assert.equal(excessSpend({ spent: 100, inbox: 5 }), 0);
});
