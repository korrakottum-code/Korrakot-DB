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
