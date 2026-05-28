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
