import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyBudgetWaste,
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

test("excessSpend measures spend beyond what target CPI justifies", () => {
  assert.equal(excessSpend({ spent: 500, inbox: 2 }), 500 - 2 * CPI_TARGET);
  assert.equal(excessSpend({ spent: 100, inbox: 5 }), 0);
});
