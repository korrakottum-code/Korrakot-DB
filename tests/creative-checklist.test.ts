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

test("scoreChecklist does not count items that require actual video playback", () => {
  const withPlaybackItem: Pick<ChecklistConfig, "categories" | "passThreshold"> = {
    passThreshold: 50,
    categories: [
      {
        id: "tech",
        label: "Technical",
        items: [
          { id: "ratio", label: "Ratio", weight: 2, appliesTo: "both" },
          { id: "hook3s", label: "Hook 3s", weight: 1, appliesTo: "video", requiresVideoPlayback: true },
        ],
      },
    ],
  };

  // วิดีโอที่ตรวจจาก thumbnail: ข้อ hook3s ต้องไม่ถูกนับ ไม่ว่าจะติ๊กหรือไม่
  const result = scoreChecklist(withPlaybackItem, ["ratio"], "video");
  assert.equal(result.totalWeight, 2);
  assert.equal(result.percent, 100);
  assert.equal(result.missingItems.length, 0);

  const unchecked = scoreChecklist(withPlaybackItem, [], "video");
  assert.equal(unchecked.missingItems.length, 1);
  assert.equal(unchecked.missingItems[0].item.id, "ratio");
});

test("scoreChecklist uses per-media threshold when provided", () => {
  const perMedia: Pick<ChecklistConfig, "categories" | "passThreshold" | "passThresholdByMedia"> = {
    passThreshold: 50,
    passThresholdByMedia: { image: 70, video: 55 },
    categories: [
      {
        id: "hook",
        label: "Hook",
        items: [
          { id: "a", label: "A", weight: 1 },
          { id: "b", label: "B", weight: 1 },
        ],
      },
    ],
  };

  const imageResult = scoreChecklist(perMedia, ["a"], "image"); // 50% < 70%
  assert.equal(imageResult.threshold, 70);
  assert.equal(imageResult.passed, false);

  const videoResult = scoreChecklist(perMedia, ["a"], "video"); // 50% < 55%
  assert.equal(videoResult.threshold, 55);
  assert.equal(videoResult.passed, false);

  const fallback = scoreChecklist({ ...perMedia, passThresholdByMedia: undefined }, ["a"], "image");
  assert.equal(fallback.threshold, 50);
  assert.equal(fallback.passed, true);
});

test("scoreChecklist excludes video-only items when reviewing a static image", () => {
  const withVideoItem: Pick<ChecklistConfig, "categories" | "passThreshold"> = {
    passThreshold: 80,
    categories: [
      {
        id: "proof",
        label: "Proof",
        items: [
          { id: "img-item", label: "Image item", weight: 1 },
          { id: "video-item", label: "Video only item", weight: 1, appliesTo: "video" },
        ],
      },
    ],
  };

  const imageResult = scoreChecklist(withVideoItem, ["img-item"], "image");
  assert.equal(imageResult.totalWeight, 1);
  assert.equal(imageResult.percent, 100);
  assert.equal(imageResult.missingItems.length, 0);

  const videoResult = scoreChecklist(withVideoItem, ["img-item"], "video");
  assert.equal(videoResult.totalWeight, 2);
  assert.equal(videoResult.missingItems.length, 1);
  assert.equal(videoResult.missingItems[0].item.id, "video-item");
});
