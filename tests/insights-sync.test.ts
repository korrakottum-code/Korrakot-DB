import assert from "node:assert/strict";
import test from "node:test";

import { chunkDateRange } from "../lib/insights-sync.ts";

test("chunkDateRange splits a long range into contiguous chunks of at most N days", () => {
  assert.deepEqual(chunkDateRange("2025-10-14", "2025-12-31", 31), [
    { since: "2025-10-14", until: "2025-11-13" },
    { since: "2025-11-14", until: "2025-12-14" },
    { since: "2025-12-15", until: "2025-12-31" },
  ]);
});

test("chunkDateRange returns a single chunk for short or one-day ranges", () => {
  assert.deepEqual(chunkDateRange("2026-10-01", "2026-10-31", 31), [{ since: "2026-10-01", until: "2026-10-31" }]);
  assert.deepEqual(chunkDateRange("2026-10-01", "2026-10-01", 31), [{ since: "2026-10-01", until: "2026-10-01" }]);
});

test("chunkDateRange crosses month/year boundaries by calendar day", () => {
  const chunks = chunkDateRange("2025-12-20", "2026-03-05", 31);
  assert.equal(chunks[0].since, "2025-12-20");
  assert.equal(chunks.at(-1)!.until, "2026-03-05");
  for (let i = 1; i < chunks.length; i++) {
    assert.equal(Date.parse(chunks[i].since) - Date.parse(chunks[i - 1].until), 86_400_000);
  }
});
