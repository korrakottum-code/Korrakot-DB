export type MediaType = "image" | "video";

export interface ChecklistItem {
  id: string;
  label: string;
  weight: number;
  appliesTo?: MediaType | "both";
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

function itemApplies(item: ChecklistItem, mediaType?: MediaType): boolean {
  if (!mediaType || !item.appliesTo || item.appliesTo === "both") return true;
  return item.appliesTo === mediaType;
}

export function scoreChecklist(
  config: Pick<ChecklistConfig, "categories" | "passThreshold">,
  checkedIds: Set<string> | string[],
  mediaType?: MediaType
): ChecklistScoreResult {
  const checked = checkedIds instanceof Set ? checkedIds : new Set(checkedIds);
  let totalWeight = 0;
  let checkedWeight = 0;
  const missingItems: { categoryLabel: string; item: ChecklistItem }[] = [];

  for (const category of config.categories) {
    for (const item of category.items) {
      if (!itemApplies(item, mediaType)) continue;
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
