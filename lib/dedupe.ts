export interface AccountLike {
  id: string;
}

export interface InsightLike {
  accountId: string;
  adId: string;
  adName: string;
  date: string;
}

export interface CampaignLike {
  accountId: string;
  campaignId: string;
}

export function dedupeAccounts<T extends AccountLike>(accounts: T[]): T[] {
  return dedupeByKey(accounts, (account) => account.id);
}

export function dedupeInsights<T extends InsightLike>(insights: T[]): T[] {
  return dedupeByKey(insights, (insight) => {
    const adKey = insight.adId || insight.adName;
    return `${insight.accountId}|${adKey}|${insight.date}`;
  });
}

export function dedupeCampaigns<T extends CampaignLike>(campaigns: T[]): T[] {
  return dedupeByKey(campaigns, (campaign) => `${campaign.accountId}|${campaign.campaignId}`);
}

function dedupeByKey<T>(rows: T[], getKey: (row: T) => string): T[] {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = getKey(row);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
