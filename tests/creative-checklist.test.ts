import assert from "node:assert/strict";
import test from "node:test";

import { scoreChecklist, type ChecklistConfig } from "../lib/creative-checklist.ts";

const config: Pick<ChecklistConfig, "categories" | "passThreshold"> = {
  passThreshold: 80,
  categories: [
    {
      id: "hook",
      label: "Hook",
      items: [
        { id: "a", label: "A", weight: 2 },
        { id: "b", label: "B", weight: 1 },
      ],
    },
    {
      id: "offer",
      label: "Offer",
      items: [{ id: "c", label: "C", weight: 1 }],
    },
  ],
};

test("scoreChecklist computes percent from checked weight over total weight", () => {
  const result = scoreChecklist(config, ["a", "c"]);
  assert.equal(result.totalWeight, 4);
  assert.equal(result.checkedWeight, 3);
  assert.equal(result.percent, 75);
  assert.equal(result.passed, false);
});

test("scoreChecklist passes when percent meets the threshold", () => {
  const result = scoreChecklist(config, new Set(["a", "b", "c"]));
  assert.equal(result.percent, 100);
  assert.equal(result.passed, true);
  assert.deepEqual(result.missingItems, []);
});

test("scoreChecklist lists missing items with their category label", () => {
  const result = scoreChecklist(config, []);
  assert.equal(result.percent, 0);
  assert.equal(result.passed, false);
  assert.equal(result.missingItems.length, 3);
  assert.equal(result.missingItems[0].categoryLabel, "Hook");
  assert.equal(result.missingItems[2].categoryLabel, "Offer");
});

test("scoreChecklist returns 0 percent for an empty category list", () => {
  const result = scoreChecklist({ passThreshold: 80, categories: [] }, []);
  assert.equal(result.totalWeight, 0);
  assert.equal(result.percent, 0);
  assert.equal(result.passed, false);
});
