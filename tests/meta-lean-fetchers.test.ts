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
            { action_type: "onsite_conversion.messaging_user_depth_3_message_send", value: "2" },
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
      depth3: 2,
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

test("fetchDailyMetrics never asks Meta for actions and delivery in one request, and merges them per ad per day", async (t) => {
  // จำลองบั๊ก Meta ต.ค. 69: คำขอที่มี actions ปนกับ spend จะได้ spend/impressions = 0
  const originalFetch = globalThis.fetch;
  const insightRequests: string[] = [];
  globalThis.fetch = async (input: string | URL | Request) => {
    const url = String(input);
    if (url.startsWith(`${META_GRAPH_API_BASE}/me/adaccounts`)) return Response.json({ data: [{ id: "act_1", name: "Udon" }] });
    if (!url.startsWith(`${META_GRAPH_API_BASE}/act_1/insights`)) throw new Error(`Unexpected URL in test: ${url}`);
    insightRequests.push(url);
    const fields = new URL(url).searchParams.get("fields") || "";
    const base = { ad_id: "ad-1", ad_name: "UDN PALL01-0990", campaign_id: "c", adset_id: "s", date_start: "2026-10-20" };
    const actions = [{ action_type: "onsite_conversion.messaging_conversation_started_7d", value: "8" }];
    if (fields.includes("actions") && fields.includes("spend")) {
      return Response.json({ data: [{ ...base, spend: "0", impressions: "0", clicks: "0", reach: "0", actions }] });
    }
    if (fields.includes("actions")) {
      return Response.json({
        data: [
          { ...base, actions },
          // แอดที่มีแต่ inbox ไม่มี delivery วันนั้น ต้องยังได้แถว
          { ad_id: "ad-2", ad_name: "UDN PALL01-0991", date_start: "2026-10-20", actions },
        ],
      });
    }
    return Response.json({ data: [{ ...base, spend: "1158.36", impressions: "17667", clicks: "146", reach: "7919" }] });
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const result = await fetchDailyMetrics("token", "2026-10-20", "2026-10-20");

  for (const url of insightRequests) {
    const fields = new URL(url).searchParams.get("fields") || "";
    assert.ok(!(fields.includes("actions") && fields.includes("spend")), `combined request: ${fields}`);
  }
  const ad1 = result.rows.find((r) => r.adId === "ad-1")!;
  assert.equal(ad1.spend, 1158.36);
  assert.equal(ad1.impressions, 17667);
  assert.equal(ad1.inbox, 8);
  const ad2 = result.rows.find((r) => r.adId === "ad-2")!;
  assert.equal(ad2.spend, 0);
  assert.equal(ad2.inbox, 8);
  assert.equal(ad2.adName, "UDN PALL01-0991");
});
