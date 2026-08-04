export type MediaType = "image" | "video";

export interface ChecklistItem {
  id: string;
  label: string;
  weight: number;
  appliesTo?: MediaType | "both";
  /** ต้องดูวิดีโอจริงถึงตัดสินได้ — ระบบวิเคราะห์จากภาพนิ่งเสมอ จึงไม่นับคะแนนข้อนี้ แต่ให้ user ตรวจเองแทน */
  requiresVideoPlayback?: boolean;
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
  /** เกณฑ์ผ่านแยกตามประเภทสื่อ ถ้าไม่มีให้ fallback ไป passThreshold */
  passThresholdByMedia?: Partial<Record<MediaType, number>>;
  sourceNote: string;
  categories: ChecklistCategory[];
}

export interface ChecklistScoreResult {
  totalWeight: number;
  checkedWeight: number;
  percent: number;
  passed: boolean;
  /** เกณฑ์ผ่านที่ใช้จริงสำหรับสื่อประเภทนี้ */
  threshold: number;
  missingItems: { categoryLabel: string; item: ChecklistItem }[];
}

function itemApplies(item: ChecklistItem, mediaType?: MediaType): boolean {
  if (!mediaType || !item.appliesTo || item.appliesTo === "both") return true;
  return item.appliesTo === mediaType;
}

/** ข้อที่ apply กับสื่อประเภทนี้แต่ AI ตัดสินจากภาพนิ่งไม่ได้ — ต้องให้คนตรวจเองก่อนขึ้นแอด */
export function manualCheckItems(
  config: Pick<ChecklistConfig, "categories">,
  mediaType?: MediaType
): { categoryLabel: string; item: ChecklistItem }[] {
  const result: { categoryLabel: string; item: ChecklistItem }[] = [];
  for (const category of config.categories) {
    for (const item of category.items) {
      if (item.requiresVideoPlayback && itemApplies(item, mediaType)) {
        result.push({ categoryLabel: category.label, item });
      }
    }
  }
  return result;
}

export function scoreChecklist(
  config: Pick<ChecklistConfig, "categories" | "passThreshold" | "passThresholdByMedia">,
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
      // ข้อที่ต้องดูวิดีโอจริงไม่ถูกนับคะแนน — ระบบวิเคราะห์จากภาพนิ่งเสมอ
      if (item.requiresVideoPlayback) continue;
      totalWeight += item.weight;
      if (checked.has(item.id)) {
        checkedWeight += item.weight;
      } else {
        missingItems.push({ categoryLabel: category.label, item });
      }
    }
  }

  const percent = totalWeight > 0 ? Math.round((checkedWeight / totalWeight) * 1000) / 10 : 0;
  const threshold =
    (mediaType ? config.passThresholdByMedia?.[mediaType] : undefined) ?? config.passThreshold;

  return {
    totalWeight,
    checkedWeight,
    percent,
    passed: percent >= threshold,
    threshold,
    missingItems,
  };
}
