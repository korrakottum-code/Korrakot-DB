import type { AdInsight } from "./meta";
import {
  classifyDimension,
  sumReportingRows,
  type ReportingDimension,
  type ReportingTotals,
} from "./reporting";

/**
 * รวมยอดโฆษณา "แยกตามสาขา" สำหรับ API ภายนอก (`/api/external/branch-metrics`)
 *
 * แยกออกมาเป็นฟังก์ชันบริสุทธิ์เพื่อให้ทดสอบได้โดยไม่ต้องมี Postgres หรือ Meta
 * — route ทำหน้าที่ auth/cache/sync แล้วส่ง rows เข้ามาที่นี่อย่างเดียว
 */

export interface BranchMetricRow extends ReportingTotals {
  code: string;
  name: string;
  dimension: ReportingDimension;
}

export interface ExcludedGroup {
  dimension: ReportingDimension;
  ads: number;
  spend: number;
}

export interface BranchMetricsResult {
  branches: BranchMetricRow[];
  totals: ReportingTotals;
  excluded: ExcludedGroup[];
}

/**
 * นับเฉพาะมิติที่เป็น "จุดขาย" จริง — สาขาปกติกับสาขารูปแบบ Class Go
 * ที่เหลือ (เพจหลัก, หน้าบ้าน, IG, HR, ส่วนกลาง, สาขาทดสอบ, ที่พาร์สไม่ออก)
 * ถูกกันออกจาก branches แต่ยังรายงานยอดรวมไว้ใน excluded ให้ผู้เรียกตรวจสอบได้
 * ว่าไม่มีงบหายไปเงียบๆ
 */
const SALES_DIMENSIONS = new Set<ReportingDimension>(["branch", "class_go"]);

export interface AggregateOptions {
  branchMap: Record<string, string>;
  testBranchCodes?: Set<string>;
  testBranchNames?: Set<string>;
}

type InsightForBranch = Pick<
  AdInsight,
  "parsed" | "spend" | "impressions" | "reach" | "clicks" | "inbox" | "leads"
>;

export function aggregateBranchMetrics(
  rows: InsightForBranch[],
  options: AggregateOptions
): BranchMetricsResult {
  const knownBranchCodes = new Set(Object.keys(options.branchMap).map((code) => code.toUpperCase()));

  const buckets = new Map<string, { name: string; dimension: ReportingDimension; rows: InsightForBranch[] }>();
  const excluded = new Map<ReportingDimension, { ads: number; spend: number }>();

  for (const row of rows) {
    const dimension = classifyDimension(row.parsed, {
      knownBranchCodes,
      testBranchCodes: options.testBranchCodes,
      testBranchNames: options.testBranchNames,
    });

    if (!SALES_DIMENSIONS.has(dimension)) {
      const bucket = excluded.get(dimension) || { ads: 0, spend: 0 };
      bucket.ads += 1;
      bucket.spend += Number.isFinite(row.spend) ? row.spend : 0;
      excluded.set(dimension, bucket);
      continue;
    }

    const code = row.parsed.branchCode.trim().toUpperCase();
    const bucket = buckets.get(code);
    if (bucket) {
      bucket.rows.push(row);
    } else {
      buckets.set(code, {
        name: options.branchMap[code] || row.parsed.branch.trim() || code,
        dimension,
        rows: [row],
      });
    }
  }

  const branches: BranchMetricRow[] = [];
  for (const [code, bucket] of buckets) {
    branches.push({ code, name: bucket.name, dimension: bucket.dimension, ...sumReportingRows(bucket.rows) });
  }
  branches.sort((a, b) => b.spend - a.spend || a.code.localeCompare(b.code));

  const salesRows = rows.filter((row) =>
    SALES_DIMENSIONS.has(
      classifyDimension(row.parsed, {
        knownBranchCodes,
        testBranchCodes: options.testBranchCodes,
        testBranchNames: options.testBranchNames,
      })
    )
  );

  return {
    branches,
    totals: sumReportingRows(salesRows),
    excluded: [...excluded.entries()]
      .map(([dimension, value]) => ({ dimension, ads: value.ads, spend: Math.round(value.spend) }))
      .sort((a, b) => b.spend - a.spend),
  };
}
