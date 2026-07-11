import assert from "node:assert/strict";
import test from "node:test";

import { dedupeAccounts, dedupeCampaigns, dedupeInsights } from "../lib/dedupe.ts";

test("dedupeAccounts keeps one account when multiple tokens see it", () => {
  const accounts = dedupeAccounts([
    { id: "act_1", name: "Main" },
    { id: "act_1", name: "Main (duplicate token)" },
    { id: "act_2", name: "Second" },
  ]);

  assert.deepEqual(accounts, [
    { id: "act_1", name: "Main" },
    { id: "act_2", name: "Second" },
  ]);
});

test("dedupeInsights keeps separate ads, dates, and accounts", () => {
  const duplicate = { accountId: "act_1", adId: "ad_1", adName: "KKC PB2-1", date: "2026-07-11", spend: 10 };
  const insights = dedupeInsights([
    duplicate,
    { ...duplicate, spend: 999 },
    { ...duplicate, date: "2026-07-10" },
    { ...duplicate, accountId: "act_2" },
    { ...duplicate, adId: "ad_2" },
  ]);

  assert.equal(insights.length, 4);
  assert.equal(insights[0].spend, 10);
});

test("dedupeInsights uses ad name when Meta omits an ad id", () => {
  const insights = dedupeInsights([
    { accountId: "act_1", adId: "", adName: "KKC PB2-1", date: "2026-07-11" },
    { accountId: "act_1", adId: "", adName: "KKC PB2-1", date: "2026-07-11" },
  ]);

  assert.equal(insights.length, 1);
});

test("dedupeCampaigns keeps one campaign per account", () => {
  const campaigns = dedupeCampaigns([
    { accountId: "act_1", campaignId: "cmp_1", spent: 10 },
    { accountId: "act_1", campaignId: "cmp_1", spent: 20 },
    { accountId: "act_2", campaignId: "cmp_1", spent: 30 },
  ]);

  assert.deepEqual(campaigns, [
    { accountId: "act_1", campaignId: "cmp_1", spent: 10 },
    { accountId: "act_2", campaignId: "cmp_1", spent: 30 },
  ]);
});
