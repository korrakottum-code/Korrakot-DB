export interface CreativeRequestGroup {
  token: string;
  adIds: string[];
  accountIds: string[];
}

export function groupCreativeRequests(
  adIds: string[],
  accountIds: string[],
  tokenByAccount: Record<string, string>,
  fallbackToken: string
): CreativeRequestGroup[] {
  const groups = new Map<string, CreativeRequestGroup>();

  adIds.forEach((adId, index) => {
    const accountId = normalizeAccountId(accountIds[index] || "");
    const token = tokenByAccount[accountId] || fallbackToken;
    const group = groups.get(token) || { token, adIds: [], accountIds: [] };
    group.adIds.push(adId);
    group.accountIds.push(accountId);
    groups.set(token, group);
  });

  return [...groups.values()];
}

export function normalizeAccountId(accountId: string): string {
  return accountId.replace(/^act_/, "");
}
