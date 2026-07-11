import assert from "node:assert/strict";
import test from "node:test";

import { decisionForBranch, isExcludedManagementGroup } from "../lib/management-rules.ts";

test("management rules never scale low-sample groups", () => {
  assert.equal(decisionForBranch({ cpi: 10, cpl: null, inbox: 1, leads: 0, objectiveKnown: true }).decision, "Low sample");
});

test("management rules use the supplied CPI and CPL targets", () => {
  assert.equal(decisionForBranch({ cpi: 90, cpl: null, inbox: 30, leads: 0, objectiveKnown: true }).decision, "Scale candidate");
  assert.equal(decisionForBranch({ cpi: null, cpl: 250, inbox: 0, leads: 30, objectiveKnown: true }).decision, "Scale candidate");
  assert.equal(decisionForBranch({ cpi: null, cpl: 500, inbox: 0, leads: 30, objectiveKnown: true }).decision, "Monitor");
});

test("unknown objective is data incomplete and HR/IG are excluded", () => {
  assert.equal(decisionForBranch({ cpi: 50, cpl: null, inbox: 100, leads: 0, objectiveKnown: false }).decision, "Data incomplete");
  assert.equal(isExcludedManagementGroup("HR"), true);
  assert.equal(isExcludedManagementGroup("IG"), true);
  assert.equal(isExcludedManagementGroup("กังสดาล"), false);
});
