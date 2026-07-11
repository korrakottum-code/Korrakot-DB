import assert from "node:assert/strict";
import test from "node:test";

import { findBestCost, hasReliableCost, MIN_BEST_ACTIONS } from "../lib/metrics.ts";

test("hasReliableCost requires spend and a minimum number of results", () => {
  assert.equal(hasReliableCost({ spend: 0, inbox: 99, leads: 0 }, "inbox"), false);
  assert.equal(hasReliableCost({ spend: 10, inbox: 1, leads: 0 }, "inbox"), false);
  assert.equal(hasReliableCost({ spend: 10, inbox: MIN_BEST_ACTIONS, leads: 0 }, "inbox"), true);
});

test("findBestCost ignores zero-spend and low-volume rows", () => {
  const result = findBestCost(
    [
      { name: "zero spend", spend: 0, inbox: 99, leads: 0 },
      { name: "one inbox", spend: 1, inbox: 1, leads: 0 },
      { name: "valid", spend: 100, inbox: MIN_BEST_ACTIONS, leads: 0 },
      { name: "better", spend: 60, inbox: MIN_BEST_ACTIONS + 1, leads: 0 },
    ],
    "inbox"
  );

  assert.deepEqual(result, { name: "better", value: 10 });
});

test("findBestCost returns null when there is no reliable result", () => {
  assert.equal(
    findBestCost([{ name: "small sample", spend: 10, inbox: 2, leads: 1 }], "leads"),
    null
  );
});
