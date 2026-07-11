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

export function findBestCost(row: CostRow[], action: "inbox" | "leads"): BestCostResult | null {
  const candidates = row
    .filter((item) => item.spend > 0 && item[action] >= MIN_BEST_ACTIONS)
    .map((item) => ({ name: item.name, value: item.spend / item[action] }))
    .sort((a, b) => a.value - b.value);

  return candidates[0] || null;
}
