import assert from "node:assert/strict";
import test from "node:test";

import { fetchAdNames, fetchDailyMetrics } from "../lib/meta.ts";
import { META_GRAPH_API_BASE } from "../lib/meta-version.ts";

function mockFetch(handlers: Record<string, unknown>) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: string | URL | Request) => {
    const url = String(input);
    for (const [prefix, body] of Object.entries(handlers)) {
      if (url.startsWith(prefix)) return Response.json(body);
    }
    throw new Error(`Unexpected URL in test: ${url}`);
  };
  return () => {
    globalThis.fetch = originalFetch;
  };
}

test("fetchAdNames returns current ad names without hitting the insights endpoint", async (t) => {
  const restore = mockFetch({
    [`${META_GRAPH_API_BASE}/me/adaccounts`]: { data: [{ id: "act_1", name: "Main" }] },
    [`${META_GRAPH_API_BASE}/act_1/ads`]: {
      data: [
        { id: "ad-1", name: "PB00-0001 ทดสอบ", campaign_id: "camp-1", adset_id: "set-1" },
        { id: "ad-2", name: "PB00-0002 ทดสอบ" },
      ],
    },
  });
  t.after(restore);

  const result = await fetchAdNames("token");

  assert.equal(result.failures.length, 0);
  assert.deepEqual(result.accounts, [{ id: "act_1", name: "Main" }]);
  assert.deepEqual(result.rows, [
    { adId: "ad-1", accountId: "act_1", adName: "PB00-0001 ทดสอบ", campaignId: "camp-1", adSetId: "set-1" },
    { adId: "ad-2", accountId: "act_1", adName: "PB00-0002 ทดสอบ", campaignId: "", adSetId: "" },
  ]);
});

test("fetchAdNames skips rows without a name and records per-account failures", async (t) => {
  const restore = mockFetch({
    [`${META_GRAPH_API_BASE}/me/adaccounts`]: {
      data: [
        { id: "act_1", name: "Main" },
        { id: "act_2", name: "Broken" },
      ],
    },
    [`${META_GRAPH_API_BASE}/act_1/ads`]: { data: [{ id: "ad-1" }, { id: "ad-2", name: "OK" }] },
    [`${META_GRAPH_API_BASE}/act_2/ads`]: { error: { message: "Application request limit reached" } },
  });
  t.after(restore);

  const result = await fetchAdNames("token");

  assert.deepEqual(result.rows, [{ adId: "ad-2", accountId: "act_1", adName: "OK", campaignId: "", adSetId: "" }]);
  assert.equal(result.failures.length, 1);
  assert.equal(result.failures[0].accountId, "act_2");
  assert.match(result.failures[0].message, /request limit/);
});

test("fetchDailyMetrics sums Meta's actions into inbox/leads per ad per day", async (t) => {
  const restore = mockFetch({
    [`${META_GRAPH_API_BASE}/me/adaccounts`]: { data: [{ id: "act_1", name: "Main" }] },
    [`${META_GRAPH_API_BASE}/act_1/insights`]: {
      data: [
        {
          ad_id: "ad-1",
          ad_name: "KKC PB00-0001",
          campaign_id: "camp-1",
          adset_id: "set-1",
          date_start: "2026-07-01",
          spend: "123.45",
          impressions: "1000",
          clicks: "10",
          reach: "900",
          actions: [
            { action_type: "onsite_conversion.messaging_conversation_started_7d", value: "3" },
            { action_type: "lead", value: "1" },
          ],
        },
      ],
    },
  });
  t.after(restore);

  const result = await fetchDailyMetrics("token", "2026-07-01", "2026-07-01");

  assert.equal(result.failures.length, 0);
  assert.deepEqual(result.rows, [
    {
      accountId: "act_1",
      adId: "ad-1",
      adName: "KKC PB00-0001",
      date: "2026-07-01",
      campaignId: "camp-1",
      adSetId: "set-1",
      spend: 123.45,
      impressions: 1000,
      clicks: 10,
      reach: 900,
      inbox: 3,
      leads: 1,
    },
  ]);
});

test("fetchDailyMetrics drops rows without an ad_id", async (t) => {
  const restore = mockFetch({
    [`${META_GRAPH_API_BASE}/me/adaccounts`]: { data: [{ id: "act_1", name: "Main" }] },
    [`${META_GRAPH_API_BASE}/act_1/insights`]: { data: [{ date_start: "2026-07-01", spend: "5" }] },
  });
  t.after(restore);

  const result = await fetchDailyMetrics("token", "2026-07-01", "2026-07-01");
  assert.deepEqual(result.rows, []);
});
