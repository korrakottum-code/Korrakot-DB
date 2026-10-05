import assert from "node:assert/strict";
import test from "node:test";

import { MAX_CREATIVE_IDS, validateCreativeQuery, validateDateQuery, validateExternalDateRangeQuery } from "../lib/request-validation.ts";

test("date query accepts known presets and valid custom ranges", () => {
  assert.deepEqual(validateDateQuery(new URLSearchParams("date_preset=today&refresh=1")), {
    ok: true,
    value: { datePreset: "today", since: undefined, until: undefined, forceRefresh: true },
  });
  assert.equal(validateDateQuery(new URLSearchParams("since=2026-07-01&until=2026-07-11")).ok, true);
});

test("date query rejects invalid or excessive ranges", () => {
  assert.equal(validateDateQuery(new URLSearchParams("date_preset=forever")).ok, false);
  assert.equal(validateDateQuery(new URLSearchParams("since=2026-07-01")).ok, false);
  assert.equal(validateDateQuery(new URLSearchParams("since=2026-02-30&until=2026-03-02")).ok, false);
  assert.equal(validateDateQuery(new URLSearchParams("since=2026-07-11&until=2026-07-01")).ok, false);
  assert.equal(validateDateQuery(new URLSearchParams("since=2025-01-01&until=2026-07-11")).ok, false);
  assert.equal(validateDateQuery(new URLSearchParams("refresh=true")).ok, false);
});

test("external date range requires both dates, valid order, and a bounded span", () => {
  assert.deepEqual(validateExternalDateRangeQuery(new URLSearchParams("since=2026-08-01&until=2026-08-31")), {
    ok: true,
    value: { since: "2026-08-01", until: "2026-08-31", groupBy: undefined },
  });
  assert.equal(validateExternalDateRangeQuery(new URLSearchParams("since=2026-08-01")).ok, false);
  assert.equal(validateExternalDateRangeQuery(new URLSearchParams("until=2026-08-31")).ok, false);
  assert.equal(validateExternalDateRangeQuery(new URLSearchParams("")).ok, false);
  assert.equal(validateExternalDateRangeQuery(new URLSearchParams("since=2026-08-31&until=2026-08-01")).ok, false);
  assert.equal(validateExternalDateRangeQuery(new URLSearchParams("since=2026-02-30&until=2026-03-01")).ok, false);
  assert.equal(validateExternalDateRangeQuery(new URLSearchParams("since=2025-01-01&until=2026-08-31")).ok, false);
  // ไม่มี preset ให้เดา — since/until เพี้ยนต้อง error ไม่ใช่ fallback
  assert.equal(validateExternalDateRangeQuery(new URLSearchParams("date_preset=today")).ok, false);
});

test("external date range accepts groupBy=day and rejects other groupBy values", () => {
  assert.deepEqual(validateExternalDateRangeQuery(new URLSearchParams("since=2026-08-01&until=2026-08-31&groupBy=day")), {
    ok: true,
    value: { since: "2026-08-01", until: "2026-08-31", groupBy: "day" },
  });
  assert.equal(validateExternalDateRangeQuery(new URLSearchParams("since=2026-08-01&until=2026-08-31&groupBy=week")).ok, false);
  assert.equal(validateExternalDateRangeQuery(new URLSearchParams("since=2026-08-01&until=2026-08-31&groupBy=")).ok, false);
});

test("creative query validates ids, alignment, and batch size", () => {
  assert.deepEqual(
    validateCreativeQuery(new URLSearchParams("ad_ids=12345,67890&account_ids=act_11111,22222")),
    { ok: true, value: { adIds: ["12345", "67890"], accountIds: ["act_11111", "22222"] } }
  );
  assert.equal(validateCreativeQuery(new URLSearchParams("ad_ids=abcde")).ok, false);
  assert.equal(validateCreativeQuery(new URLSearchParams("ad_ids=12345,67890&account_ids=11111")).ok, false);

  const tooMany = Array.from({ length: MAX_CREATIVE_IDS + 1 }, (_, index) => String(10000 + index));
  assert.equal(validateCreativeQuery(new URLSearchParams(`ad_ids=${tooMany.join(",")}`)).ok, false);
});
