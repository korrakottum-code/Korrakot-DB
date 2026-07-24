export interface ChecklistItem {
  id: string;
  label: string;
  weight: number;
}

export interface ChecklistCategory {
  id: string;
  label: string;
  items: ChecklistItem[];
}

export interface ChecklistConfig {
  version: string;
  lastUpdated: string;
  passThreshold: number;
  sourceNote: string;
  categories: ChecklistCategory[];
}

export interface ChecklistScoreResult {
  totalWeight: number;
  checkedWeight: number;
  percent: number;
  passed: boolean;
  missingItems: { categoryLabel: string; item: ChecklistItem }[];
}

export function scoreChecklist(
  config: Pick<ChecklistConfig, "categories" | "passThreshold">,
  checkedIds: Set<string> | string[]
): ChecklistScoreResult {
  const checked = checkedIds instanceof Set ? checkedIds : new Set(checkedIds);
  let totalWeight = 0;
  let checkedWeight = 0;
  const missingItems: { categoryLabel: string; item: ChecklistItem }[] = [];

  for (const category of config.categories) {
    for (const item of category.items) {
      totalWeight += item.weight;
      if (checked.has(item.id)) {
        checkedWeight += item.weight;
      } else {
        missingItems.push({ categoryLabel: category.label, item });
      }
    }
  }

  const percent = totalWeight > 0 ? Math.round((checkedWeight / totalWeight) * 1000) / 10 : 0;

  return {
    totalWeight,
    checkedWeight,
    percent,
    passed: percent >= config.passThreshold,
    missingItems,
  };
}
