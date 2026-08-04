/**
 * Pure statistics helpers used to keep the creative checklist's passThreshold
 * grounded in what real top-performing ads actually achieve, instead of a
 * fixed guess. If real Top ads only score ~60%, a fixed 80% threshold is
 * wrong — the threshold should be derived from the score distribution of
 * this week's Top ads.
 */

export interface ItemPassRate {
  id: string;
  passCount: number;
  total: number;
  rate: number; // 0-100
}

/** Nearest-rank percentile over a numeric array (0-100). Not interpolated. */
export function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const clampedP = Math.min(100, Math.max(0, p));
  const rank = Math.ceil((clampedP / 100) * sorted.length);
  const index = Math.min(sorted.length - 1, Math.max(0, rank - 1));
  return sorted[index];
}

export interface ThresholdOptions {
  percentileRank?: number; // which percentile of top-ad scores to use, default 20
  min?: number;
  max?: number;
  step?: number; // round down to nearest multiple of step
}

/**
 * Derives a passThreshold from the score distribution of this week's Top ads,
 * so that most real Top ads would actually pass the checklist. Rounded down
 * to the nearest `step` and clamped to [min, max].
 */
export function computeDataDrivenThreshold(scores: number[], options: ThresholdOptions = {}): number {
  const { percentileRank = 20, min = 50, max = 85, step = 5 } = options;
  if (!scores.length) return min;
  const raw = percentile(scores, percentileRank);
  const rounded = Math.floor(raw / step) * step;
  return Math.min(max, Math.max(min, rounded));
}

/**
 * เลือกเกณฑ์ผ่านจาก "จุดที่แยกคะแนน Top ads ออกจาก Bottom ads ได้ดีที่สุด"
 * (balanced accuracy สูงสุด) แทนการดูแค่ percentile ของ Top ฝั่งเดียว —
 * แก้ปัญหาเดิมที่พอ Top ads คะแนนต่ำ ระบบก็แค่ลดเกณฑ์ให้ผ่านง่ายขึ้นเรื่อยๆ
 * ถ้าข้อมูล Bottom ไม่พอ จะ fallback ไปวิธี percentile เดิม
 */
export function computeSeparationThreshold(
  topScores: number[],
  bottomScores: number[],
  options: ThresholdOptions & { minBottomSample?: number } = {}
): number {
  const { min = 50, max = 85, step = 5, minBottomSample = 5 } = options;
  if (!topScores.length) return min;
  if (bottomScores.length < minBottomSample) {
    return computeDataDrivenThreshold(topScores, options);
  }

  let bestScore = -1;
  let bestCandidates: number[] = [];
  for (let t = min; t <= max; t += step) {
    const topPass = topScores.filter((s) => s >= t).length / topScores.length;
    const bottomFail = bottomScores.filter((s) => s < t).length / bottomScores.length;
    const balanced = (topPass + bottomFail) / 2;
    if (balanced > bestScore + 1e-9) {
      bestScore = balanced;
      bestCandidates = [t];
    } else if (Math.abs(balanced - bestScore) <= 1e-9) {
      bestCandidates.push(t);
    }
  }
  // เสมอกันหลายค่า → เอาค่ากลางของช่วงที่เสมอ
  return bestCandidates[Math.floor((bestCandidates.length - 1) / 2)];
}

export interface ItemLift {
  id: string;
  topRate: number;
  bottomRate: number;
  /** topRate - bottomRate: ยิ่งสูง = ข้อนี้ยิ่งแยกแอดดีออกจากแอดแย่ได้ */
  lift: number;
  topTotal: number;
  bottomTotal: number;
}

/** เทียบ pass rate ของแต่ละข้อระหว่างกลุ่ม Top กับ Bottom */
export function computeItemLifts(topRates: ItemPassRate[], bottomRates: ItemPassRate[]): ItemLift[] {
  const bottomById = new Map(bottomRates.map((r) => [r.id, r]));
  return topRates
    .map((top) => {
      const bottom = bottomById.get(top.id);
      return {
        id: top.id,
        topRate: top.rate,
        bottomRate: bottom?.rate ?? 0,
        lift: Math.round((top.rate - (bottom?.rate ?? 0)) * 10) / 10,
        topTotal: top.total,
        bottomTotal: bottom?.total ?? 0,
      };
    })
    .sort((a, b) => a.lift - b.lift);
}

/** ข้อที่ Top ads ทำไม่ต่างจาก Bottom ads (lift ต่ำ) = ไม่ช่วยทำนายว่าแอดจะดี — flag ให้คนทบทวน */
export function findNonDiscriminativeItems(
  lifts: ItemLift[],
  maxLift = 10,
  minSampleSize = 5
): ItemLift[] {
  return lifts.filter(
    (item) => item.topTotal >= minSampleSize && item.bottomTotal >= minSampleSize && item.lift <= maxLift
  );
}

/**
 * น้ำหนักตาม lift (Top เทียบ Bottom): ข้อที่แยกแอดดี/แย่ได้ชัด (lift ≥ 25) → weight 2,
 * นอกนั้น → weight 1. ต่างจากวิธีเดิมที่ดูแค่ pass rate ของ Top ซึ่งให้รางวัลข้อที่
 * "ใครๆ ก็ทำ" ทั้งที่ไม่ได้ทำนายผลอะไร
 */
export function computeWeightUpdatesFromLifts(lifts: ItemLift[], minSampleSize = 5): Map<string, number> {
  const updates = new Map<string, number>();
  for (const item of lifts) {
    if (item.topTotal < minSampleSize || item.bottomTotal < minSampleSize) continue;
    updates.set(item.id, item.lift >= 25 ? 2 : 1);
  }
  return updates;
}

/** Aggregates per-item pass/fail results across multiple scored ads. */
export function computeItemPassRates(perAdResults: { id: string; met: boolean }[][]): ItemPassRate[] {
  const counts = new Map<string, { passCount: number; total: number }>();
  for (const adResults of perAdResults) {
    for (const item of adResults) {
      const entry = counts.get(item.id) || { passCount: 0, total: 0 };
      entry.total += 1;
      if (item.met) entry.passCount += 1;
      counts.set(item.id, entry);
    }
  }
  return [...counts.entries()]
    .map(([id, { passCount, total }]) => ({
      id,
      passCount,
      total,
      rate: total > 0 ? Math.round((passCount / total) * 1000) / 10 : 0,
    }))
    .sort((a, b) => a.rate - b.rate);
}

/** Item ids whose pass rate among Top ads is below `belowRate`, meaning the
 * criterion may not actually be predictive of what makes an ad a Top performer. */
export function findWeakItems(passRates: ItemPassRate[], belowRate = 30, minSampleSize = 5): ItemPassRate[] {
  return passRates.filter((item) => item.total >= minSampleSize && item.rate < belowRate);
}

/**
 * Returns a map of item id → new weight based on pass rates:
 * - rate < 30%  → weight 1 (low signal, reduce importance)
 * - rate 30-69% → weight 1 (neutral)
 * - rate ≥ 70%  → weight 2 (strong signal, increase importance)
 * Only items with enough samples (>= minSampleSize) are adjusted.
 */
export function computeWeightUpdates(
  passRates: ItemPassRate[],
  minSampleSize = 5
): Map<string, number> {
  const updates = new Map<string, number>();
  for (const item of passRates) {
    if (item.total < minSampleSize) continue;
    if (item.rate < 30) updates.set(item.id, 1);
    else if (item.rate >= 70) updates.set(item.id, 2);
    else updates.set(item.id, 1);
  }
  return updates;
}
