export interface CostRow {
  name: string;
  spend: number;
  inbox: number;
  leads: number;
}

export interface BestCostResult {
  name: string;
  value: number;
}

export const MIN_BEST_ACTIONS = 5;

export function hasReliableCost(row: Pick<CostRow, "spend" | "inbox" | "leads">, action: "inbox" | "leads"): boolean {
  return row.spend > 0 && row[action] >= MIN_BEST_ACTIONS;
}

export function findBestCost(row: CostRow[], action: "inbox" | "leads"): BestCostResult | null {
  const candidates = row
    .filter((item) => hasReliableCost(item, action))
    .map((item) => ({ name: item.name, value: item.spend / item[action] }))
    .sort((a, b) => a.value - b.value);

  return candidates[0] || null;
}
