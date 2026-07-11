import { endOfMonth, format, getDaysInMonth, setDate, startOfMonth, subDays, subMonths } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import type { AdInsight } from "./meta";
import type { ParsedAdName } from "./parser";

export const REPORTING_TIMEZONE = "Asia/Bangkok";
export const LOW_SAMPLE_RESULTS = 10;
export const HIGH_SAMPLE_RESULTS = 30;

export type ReportingPreset =
  | "today"
  | "yesterday"
  | "last_7d"
  | "last_30d"
  | "this_month"
  | "last_month";

export type ReportingDimension = "branch" | "class_go" | "central" | "non_sales" | "special" | "test" | "unknown";

export interface ReportingPeriod {
  since: string;
  until: string;
  days: number;
  elapsedDays: number;
  isPartial: boolean;
}

export interface ReportingPeriods {
  timezone: string;
  asOf: string;
  current: ReportingPeriod;
  comparison: ReportingPeriod;
  comparisonMode: "partial_period_with_pacing" | "equal_length" | "month_to_date" | "previous_day" | "previous_month";
  comparisonFair: boolean;
  notes: string[];
}

export interface ReportingTotals {
  spend: number;
  impressions: number;
  reach: number;
  clicks: number;
  inbox: number;
  leads: number;
  ctr: number | null;
  cpc: number | null;
  cpm: number | null;
  cpi: number | null;
  cpl: number | null;
}

export interface DailyReportingRow extends ReportingTotals {
  date: string;
}

export interface ObjectiveMetric {
  key: "inbox" | "leads" | "clicks" | "impressions" | "unknown";
  label: string;
  costLabel: "CPI" | "CPL" | "CPC" | "CPM" | "ไม่มี";
  reason: string;
}

export interface ConfidenceResult {
  level: "Low" | "Medium" | "High";
  sample: number;
  reason: string;
}

export interface PacingResult {
  status: "under_pace" | "on_pace" | "over_pace" | "not_available";
  spent: number;
  expectedSpend: number | null;
  variance: number | null;
  progress: number | null;
  budget: number | null;
  budgetType: "daily" | "lifetime" | "unknown";
  reason: string;
}

function parseDate(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function formatDate(date: Date): string {
  return format(date, "yyyy-MM-dd");
}

export function daysInclusive(since: string, until: string): number {
  return Math.max(1, Math.floor((parseDate(until).getTime() - parseDate(since).getTime()) / 86_400_000) + 1);
}

function period(since: Date, until: Date, isPartial = false, elapsedDays?: number): ReportingPeriod {
  const days = daysInclusive(formatDate(since), formatDate(until));
  return { since: formatDate(since), until: formatDate(until), days, elapsedDays: elapsedDays ?? days, isPartial };
}

function previousMonthSameDay(today: Date): Date {
  const previousMonth = subMonths(today, 1);
  return setDate(previousMonth, Math.min(today.getDate(), getDaysInMonth(previousMonth)));
}

export function getReportingPeriods(
  preset: ReportingPreset | "custom",
  options: { now?: Date; since?: string; until?: string; timezone?: string } = {}
): ReportingPeriods {
  const timezone = options.timezone || REPORTING_TIMEZONE;
  const now = options.now || new Date();
  const zonedNow = toZonedTime(now, timezone);
  const today = new Date(Date.UTC(zonedNow.getFullYear(), zonedNow.getMonth(), zonedNow.getDate()));
  const dayFraction = Math.max(1 / 1_440, Math.min(1, (zonedNow.getHours() * 60 + zonedNow.getMinutes() + zonedNow.getSeconds() / 60) / 1_440));
  const asOf = now.toISOString();

  if (preset === "custom" && options.since && options.until) {
    const currentSince = parseDate(options.since);
    const currentUntil = parseDate(options.until);
    const length = daysInclusive(options.since, options.until);
    const comparisonUntil = subDays(currentSince, 1);
    const comparisonSince = subDays(comparisonUntil, length - 1);
    return {
      timezone,
      asOf,
      current: period(currentSince, currentUntil),
      comparison: period(comparisonSince, comparisonUntil),
      comparisonMode: "equal_length",
      comparisonFair: true,
      notes: ["เปรียบเทียบช่วงก่อนหน้าที่มีจำนวนวันเท่ากัน"],
    };
  }

  switch (preset) {
    case "today": {
      const yesterday = subDays(today, 1);
      return {
        timezone,
        asOf,
        current: period(today, today, true, dayFraction),
        comparison: period(yesterday, yesterday, true, dayFraction),
        comparisonMode: "partial_period_with_pacing",
        comparisonFair: true,
        notes: ["วันนี้เป็นข้อมูลบางส่วนตามเวลาที่ดึงข้อมูล", "ควรอ่านคู่กับ Pacing และ As-of"],
      };
    }
    case "yesterday": {
      const yesterday = subDays(today, 1);
      return {
        timezone,
        asOf,
        current: period(yesterday, yesterday),
        comparison: period(subDays(today, 2), subDays(today, 2)),
        comparisonMode: "previous_day",
        comparisonFair: true,
        notes: ["เปรียบเทียบวันเต็มกับวันเต็มก่อนหน้า"],
      };
    }
    case "last_7d": {
      const since = subDays(today, 6);
      return {
        timezone,
        asOf,
        current: period(since, today),
        comparison: period(subDays(since, 7), subDays(today, 7)),
        comparisonMode: "equal_length",
        comparisonFair: true,
        notes: ["ช่วงก่อนหน้ามีจำนวนวันเท่ากัน"],
      };
    }
    case "this_month": {
      const currentSince = startOfMonth(today);
      const comparisonEnd = previousMonthSameDay(today);
      const comparisonSince = startOfMonth(comparisonEnd);
      return {
        timezone,
        asOf,
        current: period(currentSince, today, true, Math.max(1 / 1_440, daysInclusive(formatDate(currentSince), formatDate(today)) - 1 + dayFraction)),
        comparison: period(comparisonSince, comparisonEnd, true, Math.max(1 / 1_440, daysInclusive(formatDate(comparisonSince), formatDate(comparisonEnd)) - 1 + dayFraction)),
        comparisonMode: "month_to_date",
        comparisonFair: true,
        notes: ["เดือนนี้เทียบเดือนก่อนถึงวันเดียวกัน (MTD)", "เดือนที่มีจำนวนวันไม่เท่ากันจะถูกตัดถึงวันเดียวกัน"],
      };
    }
    case "last_month": {
      const currentSince = startOfMonth(subMonths(today, 1));
      const currentEnd = endOfMonth(subMonths(today, 1));
      const comparisonSince = startOfMonth(subMonths(today, 2));
      const comparisonEnd = endOfMonth(subMonths(today, 2));
      return {
        timezone,
        asOf,
        current: period(currentSince, currentEnd),
        comparison: period(comparisonSince, comparisonEnd),
        comparisonMode: "previous_month",
        comparisonFair: true,
        notes: ["เปรียบเทียบเดือนเต็มกับเดือนเต็มก่อนหน้า"],
      };
    }
    case "last_30d":
    default: {
      const since = subDays(today, 29);
      return {
        timezone,
        asOf,
        current: period(since, today),
        comparison: period(subDays(since, 30), subDays(today, 30)),
        comparisonMode: "equal_length",
        comparisonFair: true,
        notes: ["ช่วงก่อนหน้ามีจำนวนวันเท่ากัน"],
      };
    }
  }
}

function safeRate(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}

export function sumReportingRows(rows: Array<Pick<AdInsight, "spend" | "impressions" | "reach" | "clicks" | "inbox" | "leads">>): ReportingTotals {
  const totals = rows.reduce(
    (sum, row) => ({
      spend: sum.spend + (Number.isFinite(row.spend) ? row.spend : 0),
      impressions: sum.impressions + (Number.isFinite(row.impressions) ? row.impressions : 0),
      reach: sum.reach + (Number.isFinite(row.reach) ? row.reach : 0),
      clicks: sum.clicks + (Number.isFinite(row.clicks) ? row.clicks : 0),
      inbox: sum.inbox + (Number.isFinite(row.inbox) ? row.inbox : 0),
      leads: sum.leads + (Number.isFinite(row.leads) ? row.leads : 0),
    }),
    { spend: 0, impressions: 0, reach: 0, clicks: 0, inbox: 0, leads: 0 }
  );
  return {
    ...totals,
    ctr: safeRate(totals.clicks, totals.impressions),
    cpc: safeRate(totals.spend, totals.clicks),
    cpm: safeRate(totals.spend * 1_000, totals.impressions),
    cpi: safeRate(totals.spend, totals.inbox),
    cpl: safeRate(totals.spend, totals.leads),
  };
}

export function aggregateDaily(rows: AdInsight[]): DailyReportingRow[] {
  const byDate = new Map<string, AdInsight[]>();
  for (const row of rows) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date)) continue;
    const bucket = byDate.get(row.date) || [];
    bucket.push(row);
    byDate.set(row.date, bucket);
  }
  return [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, dateRows]) => ({ date, ...sumReportingRows(dateRows) }));
}

export function objectiveMetric(objective: string | undefined): ObjectiveMetric {
  const normalized = (objective || "").toLowerCase();
  if (normalized.includes("lead")) {
    return { key: "leads", label: "Lead", costLabel: "CPL", reason: "Objective เน้น Lead จึงใช้ Lead/CPL เป็นหลัก" };
  }
  if (normalized.includes("message") || normalized.includes("messaging")) {
    return { key: "inbox", label: "Inbox", costLabel: "CPI", reason: "Objective เน้นข้อความ จึงใช้ Inbox/CPI เป็นหลัก" };
  }
  if (normalized.includes("outcome_engagement")) {
    return { key: "inbox", label: "Inbox", costLabel: "CPI", reason: "Meta ส่งเป็น OUTCOME_ENGAGEMENT จึงใช้ Inbox เป็น proxy ของผลลัพธ์การมีส่วนร่วม; หากต้องแยกเป้าหมายย่อยให้ดู Optimization goal เพิ่ม" };
  }
  if (normalized.includes("traffic") || normalized.includes("click")) {
    return { key: "clicks", label: "Click", costLabel: "CPC", reason: "Objective เน้น Traffic จึงใช้ Click/CPC เป็นหลัก" };
  }
  if (normalized.includes("awareness") || normalized.includes("reach") || normalized.includes("brand")) {
    return { key: "impressions", label: "Impression", costLabel: "CPM", reason: "Objective เน้นการเข้าถึง จึงใช้ Impression/CPM เป็นหลัก" };
  }
  return { key: "unknown", label: "ผลลัพธ์หลักยังไม่ระบุ", costLabel: "ไม่มี", reason: "ยังไม่พบ Objective ที่รองรับ จึงไม่ควรจัดอันดับด้วย Inbox" };
}

export function confidenceForSample(sample: number, denominator = sample, hasSpend = true): ConfidenceResult {
  if (!hasSpend || sample < LOW_SAMPLE_RESULTS) {
    return { level: "Low", sample, reason: "ตัวอย่างหรือผลลัพธ์น้อยเกินไปสำหรับการสรุปผล" };
  }
  if (sample < HIGH_SAMPLE_RESULTS || denominator < 100) {
    return { level: "Medium", sample, reason: "มีข้อมูลระดับหนึ่ง แต่ยังควรติดตามต่อก่อนตัดสินใจแรง" };
  }
  return { level: "High", sample, reason: "มีผลลัพธ์และตัวหารเพียงพอสำหรับการเปรียบเทียบเบื้องต้น" };
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

export function classifyDimension(
  parsed: Pick<ParsedAdName, "branch" | "branchCode" | "isParsed">,
  options: { knownBranchCodes?: Set<string>; testBranchCodes?: Set<string>; testBranchNames?: Set<string> } = {}
): ReportingDimension {
  const branch = parsed.branch.trim();
  const branchCode = parsed.branchCode.trim().toUpperCase();
  const normalized = normalize(branch);
  const testCodes = options.testBranchCodes || new Set<string>();
  const testNames = options.testBranchNames || new Set<string>();

  if (testCodes.has(branchCode) || testNames.has(branch)) return "test";
  if (normalized.startsWith("class go") || normalized.includes("shape class go") || branchCode === "SCG") return "class_go";
  if (["ig", "หน้าบ้าน", "เพจหลัก"].includes(normalized)) return "special";
  if (["ทรัพยากรบุคคล", "hr"].includes(normalized) || branchCode === "HR") return "non_sales";
  if (["central", "ส่วนกลาง", "สำนักงานใหญ่"].includes(normalized) || ["CENTRAL", "HQ"].includes(branchCode)) return "central";
  if (!parsed.isParsed || !branchCode) return "unknown";
  if (options.knownBranchCodes && !options.knownBranchCodes.has(branchCode)) return "unknown";
  return "branch";
}

export function calculatePacing(input: {
  spent: number;
  budget?: number;
  budgetType?: "daily" | "lifetime" | "unknown" | string;
  daysElapsed: number;
  totalDays: number;
  tolerance?: number;
}): PacingResult {
  const spent = Math.max(0, input.spent);
  const budget = Number.isFinite(input.budget) && (input.budget || 0) > 0 ? input.budget! : null;
  const budgetType = input.budgetType === "daily" || input.budgetType === "lifetime" ? input.budgetType : "unknown";
  if (!budget || input.totalDays <= 0) {
    return { status: "not_available", spent, expectedSpend: null, variance: null, progress: null, budget, budgetType, reason: "ยังไม่มี Budget ที่ใช้คำนวณได้" };
  }

  const elapsed = Math.min(Math.max(input.daysElapsed, 0), input.totalDays);
  const periodBudget = budgetType === "daily" ? budget * input.totalDays : budget;
  const expectedSpend = periodBudget * (elapsed / input.totalDays);
  const variance = spent - expectedSpend;
  const tolerance = input.tolerance ?? 0.1;
  const ratio = periodBudget > 0 ? spent / periodBudget : 0;
  const expectedRatio = elapsed / input.totalDays;
  const delta = ratio - expectedRatio;
  const status = delta > tolerance ? "over_pace" : delta < -tolerance ? "under_pace" : "on_pace";
  return {
    status,
    spent,
    expectedSpend,
    variance,
    progress: ratio,
    budget: periodBudget,
    budgetType,
    reason: status === "over_pace" ? "ใช้จ่ายเร็วกว่าสัดส่วนเวลาที่ผ่านไป" : status === "under_pace" ? "ใช้จ่ายช้ากว่าสัดส่วนเวลาที่ผ่านไป" : "ใช้จ่ายใกล้เคียงกับสัดส่วนเวลาที่ผ่านไป",
  };
}
