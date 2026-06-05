import { parseAdName, ParsedAdName } from "./parser";

const META_API_BASE = "https://graph.facebook.com/v19.0";

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
}

export interface AdAccount {
  id: string;
  name: string;
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

  const fields = "ad_id,ad_name,spend,impressions,clicks,reach,ctr,cpc,cpm,actions,cost_per_action_type";
  const url = `${META_API_BASE}/${accountId}/insights?fields=${fields}&level=ad${timeRange}&limit=500&access_token=${token}`;

  const res = await fetch(url);
  const data = await res.json();

  if (data.error) {
    console.warn(`Error fetching ${accountId}: ${data.error.message}`);
    return [];
  }

  const insights: AdInsight[] = [];
  for (const row of data.data || []) {
    if (!row.ad_name) continue;
    const parsed = parseAdName(row.ad_name);

    const getAction = (actions: {action_type: string; value: string}[], type: string) =>
      parseInt(actions?.find((a) => a.action_type === type)?.value || "0");
    const getCost = (costs: {action_type: string; value: string}[], type: string) =>
      parseFloat(costs?.find((a) => a.action_type === type)?.value || "0");

    const inbox = getAction(row.actions, "onsite_conversion.messaging_conversation_started_7d");
    const leads = getAction(row.actions, "lead");
    const spend = parseFloat(row.spend || "0");

    insights.push({
      adName: row.ad_name,
      parsed,
      spend,
      impressions: parseInt(row.impressions || "0"),
      clicks: parseInt(row.clicks || "0"),
      reach: parseInt(row.reach || "0"),
      ctr: parseFloat(row.ctr || "0"),
      cpc: parseFloat(row.cpc || "0"),
      cpm: parseFloat(row.cpm || "0"),
      inbox,
      cpi: getCost(row.cost_per_action_type, "onsite_conversion.messaging_conversation_started_7d") || (inbox > 0 ? spend / inbox : 0),
      leads,
      cpl: getCost(row.cost_per_action_type, "lead") || (leads > 0 ? spend / leads : 0),
      date: row.date_start || "",
      accountId,
      accountName,
      adId: row.ad_id || "",
    });
  }

  return insights;
}

export async function fetchAllInsights(
  token: string,
  datePreset: string = "last_30d",
  since?: string,
  until?: string
): Promise<{ insights: AdInsight[]; accounts: AdAccount[] }> {
  const accounts = await fetchAllAdAccounts(token);

  const results = await Promise.allSettled(
    accounts.map((acc) =>
      fetchInsightsForAccount(acc.id, acc.name, token, datePreset, since, until)
    )
  );

  const insights: AdInsight[] = [];
  for (const result of results) {
    if (result.status === "fulfilled") {
      insights.push(...result.value);
    }
  }

  return { insights, accounts };
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
  status?: string;
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
      console.warn(`Campaign insights error ${accountId}: ${data.error.message}`);
      return [];
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
  const fields = "id,name,daily_budget,lifetime_budget,budget_remaining,status";
  let nextUrl: string | null =
    `${META_API_BASE}/${accountId}/campaigns?fields=${fields}&limit=500&access_token=${token}`;

  const rows: CampaignBudgetRaw[] = [];
  while (nextUrl) {
    const currentUrl: string = nextUrl;
    const res: Response = await fetch(currentUrl);
    const data = await res.json();
    if (data.error) {
      console.warn(`Campaign budgets error ${accountId}: ${data.error.message}`);
      return [];
    }
    rows.push(...(data.data || []));
    nextUrl = data.paging?.next || null;
  }
  return rows;
}

export async function fetchAllCampaignData(
  token: string,
  datePreset: string = "last_30d",
  since?: string,
  until?: string
): Promise<{ campaigns: CampaignRow[]; accounts: AdAccount[] }> {
  const accounts = await fetchAllAdAccounts(token);

  const results = await Promise.allSettled(
    accounts.map(async (acc) => {
      const [insightsRaw, budgetsRaw] = await Promise.all([
        fetchCampaignInsights(acc.id, token, datePreset, since, until),
        fetchCampaignBudgets(acc.id, token),
      ]);

      // Build budget lookup by campaign ID
      const budgetMap: Record<string, { budget: number; budgetType: string }> = {};
      for (const b of budgetsRaw) {
        const daily = parseFloat(b.daily_budget || "0") / 100;   // Meta returns in cents
        const lifetime = parseFloat(b.lifetime_budget || "0") / 100;
        if (daily > 0) {
          budgetMap[b.id] = { budget: daily, budgetType: "daily" };
        } else if (lifetime > 0) {
          budgetMap[b.id] = { budget: lifetime, budgetType: "lifetime" };
        } else {
          budgetMap[b.id] = { budget: 0, budgetType: "-" };
        }
      }

      return insightsRaw.map((row): CampaignRow => {
        const spend = parseFloat(row.spend || "0");
        const inbox = parseInt(
          row.actions?.find(
            (a) => a.action_type === "onsite_conversion.messaging_conversation_started_7d"
          )?.value || "0"
        );
        const budgetInfo = budgetMap[row.campaign_id] || { budget: 0, budgetType: "-" };

        return {
          accountId: acc.id,
          accountName: acc.name,
          campaignId: row.campaign_id,
          campaignName: row.campaign_name,
          spent: spend,
          budget: budgetInfo.budget,
          budgetType: budgetInfo.budgetType,
          inbox,
          cpi: inbox > 0 ? spend / inbox : 0,
        };
      });
    })
  );

  const campaigns: CampaignRow[] = [];
  for (const result of results) {
    if (result.status === "fulfilled") {
      campaigns.push(...result.value);
    }
  }

  return { campaigns, accounts };
}
