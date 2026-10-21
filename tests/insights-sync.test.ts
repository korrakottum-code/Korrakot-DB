import assert from "node:assert/strict";
import test from "node:test";

import { chunkDateRange, findSuspiciouslyCheapAccounts } from "../lib/insights-sync.ts";

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

test("findSuspiciouslyCheapAccounts flags accounts with many inboxes but near-zero spend", () => {
  const row = (accountId: string, spend: number, inbox: number) => ({
    accountId, adId: `${accountId}-${spend}`, adName: "", date: "2026-10-20", campaignId: "", adSetId: "",
    spend, impressions: 0, clicks: 0, reach: 0, inbox, depth3: 0, leads: 0,
  });
  const flagged = findSuspiciouslyCheapAccounts([
    row("act_udon", 64, 100), row("act_udon", 0, 24), // CPI ~฿0.5 → ผิดแน่
    row("act_ok", 10112, 124), // CPI ~฿81 ปกติ
    row("act_small", 0, 3), // inbox น้อยเกินจะตัดสิน
  ]);
  assert.deepEqual(flagged.map((f) => f.accountId), ["act_udon"]);
  assert.equal(flagged[0].inbox, 124);
});
