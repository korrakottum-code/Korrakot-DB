import assert from "node:assert/strict";
import test from "node:test";

import { buildReportCsv, createSnapshotId } from "../lib/report-export.ts";

test("snapshot id is stable for the same fetched snapshot", () => {
  const input = { since: "2026-07-01", until: "2026-07-11", comparisonSince: "2026-06-01", comparisonUntil: "2026-06-11", fetchedAt: "2026-07-11T10:00:00.000Z" };
  assert.equal(createSnapshotId(input), createSnapshotId(input));
  assert.notEqual(createSnapshotId(input), createSnapshotId({ ...input, fetchedAt: "2026-07-11T10:01:00.000Z" }));
});

test("CSV includes metadata, Thai-safe BOM, quoted cells, and matching rows", () => {
  const csv = buildReportCsv(
    { snapshotId: "snapshot-1", periodSince: "2026-07-01", periodUntil: "2026-07-11", comparisonSince: "2026-06-01", comparisonUntil: "2026-06-11", objective: "ALL", timezone: "Asia/Bangkok", asOf: "now", generatedAt: "now", coverage: "10/10", confidence: "Medium" },
    [{ name: "สาขา, ทดลอง", spend: 100, share: 1, inbox: 10, leads: 2, cpi: 10, cpl: 50, decision: "Monitor", confidence: "Medium" }],
    [{ date: "2026-07-11", spend: 100, impressions: 1000, clicks: 100, inbox: 10, leads: 2 }]
  );
  assert.ok(csv.startsWith("\uFEFF"));
  assert.ok(csv.includes("snapshot-1"));
  assert.ok(csv.includes('"สาขา, ทดลอง"'));
  assert.ok(csv.includes("2026-07-11,100,1000,100,10,2"));
});
