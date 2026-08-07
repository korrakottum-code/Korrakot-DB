import { parseAdName, ParsedAdName } from "./parser";
import { fetchGraphPages } from "./pagination";
import { META_GRAPH_API_BASE } from "./meta-version";
import type { AdNameRow, DailyMetricRow } from "./insights-store";


/** Retry after a delay when Meta returns a rate-limit error. Fast path is unchanged. */
async function withRateLimitRetry<T>(fn: () => Promise<T>, retries = 2, delayMs = 5000): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    const msg = err instanceof Error ? err.message.toLowerCase() : "";
    if (retries > 0 && (msg.includes("request limit") || msg.includes("rate limit"))) {
      await new Promise((r) => setTimeout(r, delayMs));
      return withRateLimitRetry(fn, retries - 1, delayMs * 2);
    }
    throw err;
  }
}

// Meta นับโควตาคำขอระดับ user แบบ burst — ยิงทุกบัญชีพร้อมกันทำให้ติด
// "User request limit reached" จึงคุมจำนวนคำขอที่วิ่งพร้อมกันต่อ token
// (ทดสอบจริง: concurrency=8 ยิงถี่ขึ้นแล้วกลับติด limit มากกว่า concurrency=4 —
// ปัญหาจริงคือปริมาณข้อมูลต่อคำขอ ไม่ใช่จำนวนคำขอพร้อมกัน แก้ที่ lib/insights-store.ts แทน)
const ACCOUNT_FETCH_CONCURRENCY = 4;

async function mapSettledWithConcurrency<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>,
  limit = ACCOUNT_FETCH_CONCURRENCY
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      try {
        results[index] = { status: "fulfilled", value: await fn(items[index]) };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
    }
  });
  await Promise.all(workers);
  return results;
}

const META_API_BASE = META_GRAPH_API_BASE;

export interface AdInsight {
  adName: string;
  parsed: ParsedAdName;
  spend: number;
  impressions: number;
  clicks: number;
  reach: number;
  ctr: number;
  cpc: number;
  cpm: number;
  inbox: number;
  cpi: number;
  leads: number;
  cpl: number;
  date: string;
  accountId: string;
  accountName: string;
  adId: string;
  campaignId?: string;
  adSetId?: string;
  objective?: string;
  optimizationGoal?: string;
  status?: string;
  effectiveStatus?: string;
  budget?: number;
  budgetType?: string;
  budgetRemaining?: number;
}

export interface AdAccount {
  id: string;
  name: string;
}

export interface FetchFailure {
  scope: "accounts" | "insights" | "campaigns";
  accountId?: string;
  accountName?: string;
  message: string;
}

async function fetchAllAdAccounts(token: string): Promise<AdAccount[]> {
  const accounts: AdAccount[] = [];
  let url = `${META_API_BASE}/me/adaccounts?fields=id,name&limit=50&access_token=${token}`;

  while (url) {
    const res = await fetch(url);
    const data = await res.json();
    if (data.error) throw new Error(data.error.message);
    accounts.push(...(data.data || []));
    url = data.paging?.next || null;
  }

  return accounts;
}

async function fetchInsightsForAccount(
  accountId: string,
  accountName: string,
  token: string,
  datePreset: string,
  since?: string,
  until?: string
): Promise<AdInsight[]> {
  let timeRange = "";
  if (since && until) {
    timeRange = `&time_range={"since":"${since}","until":"${until}"}`;
  } else {
    timeRange = `&date_preset=${datePreset}`;
  }

  const fields = "ad_id,ad_name,campaign_id,adset_id,spend,impressions,clicks,reach,ctr,cpc,cpm,actions,cost_per_action_type";
  const insights: AdInsight[] = [];
  const initialUrl = `${META_API_BASE}/${accountId}/insights?fields=${fields}&level=ad&time_increment=1${timeRange}&limit=500&access_token=${token}`;
  const result = await fetchGraphPages<Record<string, unknown>>(initialUrl);

  if (result.error) {
    throw new Error(result.error.message);
  }

  for (const row of result.data) {
    if (!row.ad_name) continue;
    const adName = String(row.ad_name);
    const parsed = parseAdName(adName);

    const getAction = (actions: {action_type: string; value: string}[], type: string) =>
      parseInt(actions?.find((a) => a.action_type === type)?.value || "0");
    const getCost = (costs: {action_type: string; value: string}[], type: string) =>
      parseFloat(costs?.find((a) => a.action_type === type)?.value || "0");

    const actions = row.actions as { action_type: string; value: string }[];
    const costs = row.cost_per_action_type as { action_type: string; value: string }[];
    const inbox = getAction(actions, "onsite_conversion.messaging_conversation_started_7d");
    const leads = getAction(actions, "lead");
    const spend = parseFloat(String(row.spend || "0"));

    insights.push({
      adName,
      parsed,
      spend,
      impressions: parseInt(String(row.impressions || "0")),
      clicks: parseInt(String(row.clicks || "0")),
      reach: parseInt(String(row.reach || "0")),
      ctr: parseFloat(String(row.ctr || "0")),
      cpc: parseFloat(String(row.cpc || "0")),
      cpm: parseFloat(String(row.cpm || "0")),
      inbox,
      cpi: getCost(costs, "onsite_conversion.messaging_conversation_started_7d") || (inbox > 0 ? spend / inbox : 0),
      leads,
      cpl: getCost(costs, "lead") || (leads > 0 ? spend / leads : 0),
      date: String(row.date_start || ""),
      accountId,
      accountName,
      adId: String(row.ad_id || ""),
      campaignId: String(row.campaign_id || ""),
      adSetId: String(row.adset_id || ""),
    });
  }

  return insights;
}

export async function fetchAllInsights(
  token: string,
  datePreset: string = "last_30d",
  since?: string,
  until?: string
): Promise<{ insights: AdInsight[]; accounts: AdAccount[]; failures: FetchFailure[] }> {
  let accounts: AdAccount[];
  try {
    accounts = await fetchAllAdAccounts(token);
  } catch (error: unknown) {
    return {
      insights: [],
      accounts: [],
      failures: [{ scope: "accounts", message: error instanceof Error ? error.message : "Unknown account error" }],
    };
  }

  const results = await mapSettledWithConcurrency(accounts, (acc) =>
    withRateLimitRetry(() => fetchInsightsForAccount(acc.id, acc.name, token, datePreset, since, until))
  );

  const insights: AdInsight[] = [];
  const failures: FetchFailure[] = [];
  for (const [index, result] of results.entries()) {
    if (result.status === "fulfilled") {
      insights.push(...result.value);
    } else {
      const account = accounts[index];
      failures.push({
        scope: "insights",
        accountId: account.id,
        accountName: account.name,
        message: result.reason instanceof Error ? result.reason.message : "Unknown insights error",
      });
    }
  }

  return { insights, accounts, failures };
}

/* ──────────────────────────────────────────────
   Lean fetchers for the persistent insights store (lib/insights-store.ts).
   Metrics and ad names are fetched/stored separately — see that file's
   header comment for why (ad renames must not corrupt historical rows).
   ────────────────────────────────────────────── */

async function fetchDailyMetricsForAccount(
  accountId: string,
  token: string,
  since: string,
  until: string
): Promise<DailyMetricRow[]> {
  // ad_name มาฟรีกับ insights (เป็นชื่อปัจจุบัน ณ เวลา fetch) — ใช้อัปเดต ad_name_cache
  // โดยไม่ต้องกวาดรายชื่อแอดทั้งบัญชีแยกอีกรอบ
  const fields = "ad_id,ad_name,campaign_id,adset_id,spend,impressions,clicks,reach,actions";
  const timeRange = `&time_range={"since":"${since}","until":"${until}"}`;
  const initialUrl = `${META_API_BASE}/${accountId}/insights?fields=${fields}&level=ad&time_increment=1${timeRange}&limit=500&access_token=${token}`;
  const result = await fetchGraphPages<Record<string, unknown>>(initialUrl);

  if (result.error) throw new Error(result.error.message);

  const rows: DailyMetricRow[] = [];
  for (const row of result.data) {
    const adId = String(row.ad_id || "");
    if (!adId) continue;
    const getAction = (actions: { action_type: string; value: string }[], type: string) =>
      parseInt(actions?.find((a) => a.action_type === type)?.value || "0");
    const actions = row.actions as { action_type: string; value: string }[];

    rows.push({
      accountId,
      adId,
      adName: String(row.ad_name || ""),
      date: String(row.date_start || ""),
      campaignId: String(row.campaign_id || ""),
      adSetId: String(row.adset_id || ""),
      spend: parseFloat(String(row.spend || "0")),
      impressions: parseInt(String(row.impressions || "0")),
      clicks: parseInt(String(row.clicks || "0")),
      reach: parseInt(String(row.reach || "0")),
      inbox: getAction(actions, "onsite_conversion.messaging_conversation_started_7d"),
      leads: getAction(actions, "lead"),
    });
  }
  return rows;
}

/** Fetches daily ad-level metrics for one date range across all of a token's accounts — used to backfill/refresh the persistent store. */
export async function fetchDailyMetrics(
  token: string,
  since: string,
  until: string
): Promise<{ rows: DailyMetricRow[]; accounts: AdAccount[]; failures: FetchFailure[] }> {
  let accounts: AdAccount[];
  try {
    accounts = await fetchAllAdAccounts(token);
  } catch (error: unknown) {
    return {
      rows: [],
      accounts: [],
      failures: [{ scope: "accounts", message: error instanceof Error ? error.message : "Unknown account error" }],
    };
  }

  const results = await mapSettledWithConcurrency(accounts, (acc) =>
    withRateLimitRetry(() => fetchDailyMetricsForAccount(acc.id, token, since, until))
  );

  const rows: DailyMetricRow[] = [];
  const failures: FetchFailure[] = [];
  for (const [index, result] of results.entries()) {
    if (result.status === "fulfilled") {
      rows.push(...result.value);
    } else {
      const account = accounts[index];
      failures.push({
        scope: "insights",
        accountId: account.id,
        accountName: account.name,
        message: result.reason instanceof Error ? result.reason.message : "Unknown insights error",
      });
    }
  }

  return { rows, accounts, failures };
}

/** Just the token's ad-account list — 1-2 requests, cheap enough to cache per token and reuse across presets. */
export async function fetchAccounts(token: string): Promise<{ accounts: AdAccount[]; failures: FetchFailure[] }> {
  try {
    return { accounts: await fetchAllAdAccounts(token), failures: [] };
  } catch (error: unknown) {
    return {
      accounts: [],
      failures: [{ scope: "accounts", message: error instanceof Error ? error.message : "Unknown account error" }],
    };
  }
}

async function fetchAdNamesForAccount(accountId: string, token: string): Promise<AdNameRow[]> {
  const initialUrl = `${META_API_BASE}/${accountId}/ads?fields=id,name,campaign_id,adset_id&limit=500&access_token=${token}`;
  const result = await fetchGraphPages<Record<string, unknown>>(initialUrl);

  if (result.error) throw new Error(result.error.message);

  const rows: AdNameRow[] = [];
  for (const row of result.data) {
    const adId = String(row.id || "");
    if (!adId || !row.name) continue;
    rows.push({
      adId,
      accountId,
      adName: String(row.name),
      campaignId: String(row.campaign_id || ""),
      adSetId: String(row.adset_id || ""),
    });
  }
  return rows;
}

/** Fetches every ad's CURRENT name across all of a token's accounts — cheap (no time_increment/metrics), meant to be refreshed often via the existing server-cache TTL. */
export async function fetchAdNames(
  token: string
): Promise<{ rows: AdNameRow[]; accounts: AdAccount[]; failures: FetchFailure[] }> {
  let accounts: AdAccount[];
  try {
    accounts = await fetchAllAdAccounts(token);
  } catch (error: unknown) {
    return {
      rows: [],
      accounts: [],
      failures: [{ scope: "accounts", message: error instanceof Error ? error.message : "Unknown account error" }],
    };
  }

  const results = await mapSettledWithConcurrency(accounts, (acc) =>
    withRateLimitRetry(() => fetchAdNamesForAccount(acc.id, token))
  );

  const rows: AdNameRow[] = [];
  const failures: FetchFailure[] = [];
  for (const [index, result] of results.entries()) {
    if (result.status === "fulfilled") {
      rows.push(...result.value);
    } else {
      const account = accounts[index];
      failures.push({
        scope: "insights",
        accountId: account.id,
        accountName: account.name,
        message: result.reason instanceof Error ? result.reason.message : "Unknown ad-name error",
      });
    }
  }

  return { rows, accounts, failures };
}

/* ──────────────────────────────────────────────
   Campaign-level types & fetchers
   ────────────────────────────────────────────── */

export interface CampaignRow {
  accountId: string;
  accountName: string;
  campaignId: string;
  campaignName: string;
  spent: number;
  budget: number;       // daily_budget or lifetime_budget (whichever is set), in account currency
  budgetType: string;   // "daily" | "lifetime" | "-"
  budgetRemaining: number | null;
  objective: string;
  status: string;
  effectiveStatus: string;
  optimizationGoal?: string;
  inbox: number;
  cpi: number;
}

interface CampaignInsightRaw {
  campaign_id: string;
  campaign_name: string;
  spend: string;
  impressions: string;
  actions?: { action_type: string; value: string }[];
  cost_per_action_type?: { action_type: string; value: string }[];
}

interface CampaignBudgetRaw {
  id: string;
  name: string;
  daily_budget?: string;
  lifetime_budget?: string;
  budget_remaining?: string;
  objective?: string;
  status?: string;
  effective_status?: string;
  optimization_goal?: string;
}

interface AdSetOptimizationRaw {
  id: string;
  campaign_id?: string;
  optimization_goal?: string;
}

async function fetchAdSetOptimizationGoals(accountId: string, token: string): Promise<Record<string, string>> {
  const fields = "id,campaign_id,optimization_goal";
  let nextUrl: string | null = `${META_API_BASE}/${accountId}/adsets?fields=${fields}&limit=500&access_token=${token}`;
  const goals: Record<string, string> = {};
  while (nextUrl) {
    const res = await fetch(nextUrl);
    const data = await res.json() as { error?: { message: string }; data?: AdSetOptimizationRaw[]; paging?: { next?: string } };
    if (data.error) throw new Error(data.error.message);
    for (const row of data.data || []) {
      if (row.id && row.optimization_goal) goals[row.id] = row.optimization_goal;
    }
    nextUrl = data.paging?.next || null;
  }
  return goals;
}

async function fetchCampaignInsights(
  accountId: string,
  token: string,
  datePreset: string,
  since?: string,
  until?: string
): Promise<CampaignInsightRaw[]> {
  let timeRange = "";
  if (since && until) {
    timeRange = `&time_range={"since":"${since}","until":"${until}"}`;
  } else {
    timeRange = `&date_preset=${datePreset}`;
  }

  const fields = "campaign_id,campaign_name,spend,impressions,actions,cost_per_action_type";
  let nextUrl: string | null =
    `${META_API_BASE}/${accountId}/insights?fields=${fields}&level=campaign${timeRange}&limit=500&access_token=${token}`;

  const rows: CampaignInsightRaw[] = [];
  while (nextUrl) {
    const currentUrl: string = nextUrl;
    const res: Response = await fetch(currentUrl);
    const data = await res.json();
    if (data.error) {
      throw new Error(data.error.message);
    }
    rows.push(...(data.data || []));
    nextUrl = data.paging?.next || null;
  }
  return rows;
}

async function fetchCampaignBudgets(
  accountId: string,
  token: string
): Promise<CampaignBudgetRaw[]> {
  const fields = "id,name,daily_budget,lifetime_budget,budget_remaining,objective,status,effective_status";
  let nextUrl: string | null =
    `${META_API_BASE}/${accountId}/campaigns?fields=${fields}&limit=500&access_token=${token}`;

  const rows: CampaignBudgetRaw[] = [];
  while (nextUrl) {
    const currentUrl: string = nextUrl;
    const res: Response = await fetch(currentUrl);
    const data = await res.json();
    if (data.error) {
      throw new Error(data.error.message);
    }
    rows.push(...(data.data || []));
    nextUrl = data.paging?.next || null;
  }
  return rows;
}

/** Fetch campaign metadata without fetching a second insights time series. */
export async function fetchAllCampaignMetadata(
  token: string
): Promise<{ campaigns: CampaignRow[]; adSetGoals: Record<string, string>; accounts: AdAccount[]; failures: FetchFailure[] }> {
  let accounts: AdAccount[];
  try {
    accounts = await fetchAllAdAccounts(token);
  } catch (error: unknown) {
    return {
      campaigns: [],
      adSetGoals: {},
      accounts: [],
      failures: [{ scope: "accounts", message: error instanceof Error ? error.message : "Unknown account error" }],
    };
  }

  const results = await mapSettledWithConcurrency(accounts, (acc) =>
      withRateLimitRetry(async () => {
      const [budgets, adSetGoals] = await Promise.all([fetchCampaignBudgets(acc.id, token), fetchAdSetOptimizationGoals(acc.id, token)]);
      const campaigns = budgets.map((budget): CampaignRow => ({
        accountId: acc.id,
        accountName: acc.name,
        campaignId: budget.id,
        campaignName: budget.name,
        spent: 0,
        budget: budget.daily_budget ? parseFloat(budget.daily_budget) / 100 : budget.lifetime_budget ? parseFloat(budget.lifetime_budget) / 100 : 0,
        budgetType: budget.daily_budget ? "daily" : budget.lifetime_budget ? "lifetime" : "-",
        budgetRemaining: budget.budget_remaining ? parseFloat(budget.budget_remaining) / 100 : null,
        objective: budget.objective || "",
        optimizationGoal: budget.optimization_goal || "",
        status: budget.status || "",
        effectiveStatus: budget.effective_status || "",
        inbox: 0,
        cpi: 0,
      }));
      return { campaigns, adSetGoals };
    })
  );

  const campaigns: CampaignRow[] = [];
  const adSetGoals: Record<string, string> = {};
  const failures: FetchFailure[] = [];
  for (const [index, result] of results.entries()) {
    if (result.status === "fulfilled") {
      campaigns.push(...result.value.campaigns);
      Object.assign(adSetGoals, result.value.adSetGoals);
    } else {
      const account = accounts[index];
      failures.push({
        scope: "campaigns",
        accountId: account.id,
        accountName: account.name,
        message: result.reason instanceof Error ? result.reason.message : "Unknown campaign metadata error",
      });
    }
  }
  return { campaigns, adSetGoals, accounts, failures };
}

export async function fetchAllCampaignData(
  token: string,
  datePreset: string = "last_30d",
  since?: string,
  until?: string
): Promise<{ campaigns: CampaignRow[]; accounts: AdAccount[]; failures: FetchFailure[] }> {
  let accounts: AdAccount[];
  try {
    accounts = await fetchAllAdAccounts(token);
  } catch (error: unknown) {
    return {
      campaigns: [],
      accounts: [],
      failures: [{ scope: "accounts", message: error instanceof Error ? error.message : "Unknown account error" }],
    };
  }

  const results = await mapSettledWithConcurrency(accounts, (acc) =>
      withRateLimitRetry(async () => {
      const [insightsRaw, budgetsRaw] = await Promise.all([
        fetchCampaignInsights(acc.id, token, datePreset, since, until),
        fetchCampaignBudgets(acc.id, token),
      ]);

      // Build budget lookup by campaign ID
      const budgetMap: Record<string, { budget: number; budgetType: string; budgetRemaining: number | null; objective: string; optimizationGoal: string; status: string; effectiveStatus: string }> = {};
      for (const b of budgetsRaw) {
        const daily = parseFloat(b.daily_budget || "0") / 100;   // Meta returns in cents
        const lifetime = parseFloat(b.lifetime_budget || "0") / 100;
        if (daily > 0) {
          budgetMap[b.id] = { budget: daily, budgetType: "daily", budgetRemaining: b.budget_remaining ? parseFloat(b.budget_remaining) / 100 : null, objective: b.objective || "", optimizationGoal: b.optimization_goal || "", status: b.status || "", effectiveStatus: b.effective_status || "" };
        } else if (lifetime > 0) {
          budgetMap[b.id] = { budget: lifetime, budgetType: "lifetime", budgetRemaining: b.budget_remaining ? parseFloat(b.budget_remaining) / 100 : null, objective: b.objective || "", optimizationGoal: b.optimization_goal || "", status: b.status || "", effectiveStatus: b.effective_status || "" };
        } else {
          budgetMap[b.id] = { budget: 0, budgetType: "-", budgetRemaining: b.budget_remaining ? parseFloat(b.budget_remaining) / 100 : null, objective: b.objective || "", optimizationGoal: b.optimization_goal || "", status: b.status || "", effectiveStatus: b.effective_status || "" };
        }
      }

      return insightsRaw.map((row): CampaignRow => {
        const spend = parseFloat(row.spend || "0");
        const inbox = parseInt(
          row.actions?.find(
            (a) => a.action_type === "onsite_conversion.messaging_conversation_started_7d"
          )?.value || "0"
        );
        const budgetInfo = budgetMap[row.campaign_id] || { budget: 0, budgetType: "-", budgetRemaining: null, objective: "", optimizationGoal: "", status: "", effectiveStatus: "" };

        return {
          accountId: acc.id,
          accountName: acc.name,
          campaignId: row.campaign_id,
          campaignName: row.campaign_name,
          spent: spend,
          budget: budgetInfo.budget,
          budgetType: budgetInfo.budgetType,
          budgetRemaining: budgetInfo.budgetRemaining,
          objective: budgetInfo.objective,
          optimizationGoal: budgetInfo.optimizationGoal,
          status: budgetInfo.status,
          effectiveStatus: budgetInfo.effectiveStatus,
          inbox,
          cpi: inbox > 0 ? spend / inbox : 0,
        };
      });
    })
  );

  const campaigns: CampaignRow[] = [];
  const failures: FetchFailure[] = [];
  for (const [index, result] of results.entries()) {
    if (result.status === "fulfilled") {
      campaigns.push(...result.value);
    } else {
      const account = accounts[index];
      failures.push({
        scope: "campaigns",
        accountId: account.id,
        accountName: account.name,
        message: result.reason instanceof Error ? result.reason.message : "Unknown campaign error",
      });
    }
  }

  return { campaigns, accounts, failures };
}
