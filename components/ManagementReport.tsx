"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  CheckCircle2,
  Clock3,
  Download,
  Gauge,
  Printer,
  RefreshCw,
  ShieldCheck,
  Target,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import LogoutButton from "@/components/LogoutButton";
import type { AdInsight } from "@/lib/meta";
import type {
  DailyReportingRow,
  ObjectiveMetric,
  PacingResult,
  ReportingPeriods,
  ReportingTotals,
} from "@/lib/reporting";
import { objectiveMetric, sumReportingRows } from "@/lib/reporting";
import {
  CPI_TARGET,
  CPL_TARGET_MAX,
  CPL_TARGET_MIN,
  decisionForBranch,
  isExcludedManagementGroup,
  type Decision,
} from "@/lib/management-rules";
import { buildReportCsv } from "@/lib/report-export";

const PERIODS = [
  { value: "today", label: "วันนี้" },
  { value: "last_7d", label: "7 วัน" },
  { value: "last_30d", label: "30 วัน" },
  { value: "this_month", label: "เดือนนี้" },
] as const;

type ReportResponse = {
  insights: AdInsight[];
  previousInsights: AdInsight[];
  totals: ReportingTotals;
  previousTotals: ReportingTotals;
  periods: ReportingPeriods;
  dailySeries: DailyReportingRow[];
  previousDailySeries: DailyReportingRow[];
  objectiveBreakdown: Array<{ objective: string; metric: ObjectiveMetric; totals: ReportingTotals; confidence: { level: "Low" | "Medium" | "High"; sample: number; reason: string } }>;
  classification: { counts: Record<string, number>; knownBranchCodes: number };
  statusBreakdown: Array<{ objective: string; status: string; effectiveStatus: string; campaigns: number; spend: number; budget: number }>;
  pacing: { daily: PacingResult; lifetime: PacingResult; note: string };
  coverage: { accountsTotal: number; accountsWithFailures: number; accountsComplete: number; rows: number; parsedRows: number; unknownRows: number; failureCount: number; complete: boolean };
  failures: Array<{ scope: string; accountId?: string; accountName?: string; message: string }>;
  asOf: string;
  generatedAt: string;
  snapshotId: string;
  cache: { hit: boolean; fetchedAt: string; asOf: string };
};

type BranchSummary = {
  name: string;
  spend: number;
  inbox: number;
  leads: number;
  impressions: number;
  cpi: number | null;
  cpl: number | null;
  share: number;
  decision: Decision;
  confidence: "Low" | "Medium" | "High";
  reason: string;
  objectiveLabel: string;
  sampleLabel: string;
  sampleValue: number;
};

function fmtNumber(value: number) {
  return value.toLocaleString("th-TH", { maximumFractionDigits: 0 });
}

function fmtMoney(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "ไม่มีข้อมูล";
  if (value >= 1_000_000) return `฿${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `฿${(value / 1_000).toFixed(1)}K`;
  return `฿${value.toFixed(0)}`;
}

function pctChange(current: number, previous: number): number | null {
  return previous > 0 ? ((current - previous) / previous) * 100 : null;
}

function normalizeObjective(value: string | undefined) {
  return (value || "UNKNOWN").toUpperCase();
}

function objectiveLabel(value: string) {
  return value === "ALL" ? "ทุก Objective" : value;
}

function decisionClass(decision: Decision) {
  if (decision === "Scale candidate") return "border-emerald-700/60 bg-emerald-950/30 text-emerald-300";
  if (decision === "Low sample") return "border-amber-700/60 bg-amber-950/30 text-amber-300";
  if (decision === "Data incomplete" || decision === "Review") return "border-rose-700/60 bg-rose-950/30 text-rose-300";
  return "border-sky-700/60 bg-sky-950/30 text-sky-300";
}

function formatPacing(pacing: PacingResult) {
  if (pacing.status === "not_available") return "ยังไม่มี Budget ที่คำนวณได้";
  if (pacing.status === "over_pace") return "ใช้จ่ายเร็วกว่าเวลา";
  if (pacing.status === "under_pace") return "ใช้จ่ายช้ากว่าเวลา";
  return "อยู่ใกล้แผน";
}

function MetricCard({ label, value, change, tone = "indigo", partial }: { label: string; value: string; change?: number | null; tone?: string; partial?: boolean }) {
  const positive = change != null && change >= 0;
  const toneClass: Record<string, string> = {
    indigo: "text-indigo-300",
    emerald: "text-emerald-300",
    purple: "text-purple-300",
    amber: "text-amber-300",
    pink: "text-pink-300",
  };
  return (
    <div className="rounded-xl border border-slate-800 bg-gradient-to-br from-slate-900 to-slate-950 p-4">
      <p className="text-xs text-slate-400">{label}</p>
      <p className={`mt-2 text-2xl font-bold ${toneClass[tone] || toneClass.indigo}`}>{value}</p>
      {change != null && (
        <p className={`mt-1 flex items-center gap-1 text-xs ${partial ? "text-slate-400" : positive ? "text-rose-300" : "text-emerald-300"}`}>
          {positive ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownRight className="h-3.5 w-3.5" />}
          {positive ? "+" : ""}{change.toFixed(1)}% {partial ? "เทียบช่วงเวลาเดียวกัน (ยังไม่จบวัน)" : "เทียบช่วงก่อน"}
        </p>
      )}
    </div>
  );
}

export default function ManagementReport() {
  const initialParams = typeof window === "undefined" ? null : new URLSearchParams(window.location.search);
  const initialPeriod = initialParams?.get("period");
  const initialObjective = initialParams?.get("objective");
  const [period, setPeriod] = useState<(typeof PERIODS)[number]["value"]>(
    PERIODS.some((item) => item.value === initialPeriod) ? initialPeriod as (typeof PERIODS)[number]["value"] : "today"
  );
  const [objectiveFilter, setObjectiveFilter] = useState(initialObjective || "ALL");
  const [report, setReport] = useState<ReportResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const requestReport = (selectedPeriod: string, force = false) => {
    const query = `/api/insights?date_preset=${selectedPeriod}${force ? "&refresh=1" : ""}`;
    return fetch(query).then(async (response) => {
      const data = await response.json() as ReportResponse & { error?: string };
      if (!response.ok || data.error) throw new Error(data.error || "โหลดรายงานไม่สำเร็จ");
      return data;
    });
  };

  const load = (force = false) => {
    if (force) setRefreshing(true);
    setError("");
    requestReport(period, force)
      .then((data) => setReport(data))
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "โหลดรายงานไม่สำเร็จ"))
      .finally(() => {
        setLoading(false);
        setRefreshing(false);
      });
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (period === "today") params.delete("period");
    else params.set("period", period);
    if (objectiveFilter === "ALL") params.delete("objective");
    else params.set("objective", objectiveFilter);
    window.history.replaceState(null, "", `${window.location.pathname}${params.toString() ? `?${params}` : ""}`);
  }, [period, objectiveFilter]);

  useEffect(() => {
    let active = true;
    requestReport(period)
      .then((data) => { if (active) setReport(data); })
      .catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : "โหลดรายงานไม่สำเร็จ"); })
      .finally(() => { if (active) { setLoading(false); setRefreshing(false); } });
    return () => { active = false; };
  }, [period]);

  const filteredInsights = useMemo(
    () => report?.insights.filter((row) => objectiveFilter === "ALL" || normalizeObjective(row.objective) === objectiveFilter) || [],
    [report?.insights, objectiveFilter]
  );

  const objectiveOptions = useMemo(
    () => ["ALL", ...Array.from(new Set(report?.insights.map((row) => normalizeObjective(row.objective)) || []))],
    [report?.insights]
  );

  const branchSummaries = useMemo<BranchSummary[]>(() => {
    if (!report) return [];
    const map = new Map<string, { rows: AdInsight[]; objectiveKnown: boolean; objectives: Set<string>; metricKeys: Set<string> }>();
    for (const row of filteredInsights) {
      const name = row.parsed.branch || row.parsed.branchCode || "ไม่ระบุ";
      if (isExcludedManagementGroup(name)) continue;
      const current = map.get(name) || { rows: [], objectiveKnown: true, objectives: new Set<string>(), metricKeys: new Set<string>() };
      current.rows.push(row);
      current.objectiveKnown = current.objectiveKnown && Boolean(row.objective);
      current.objectives.add(normalizeObjective(row.objective));
      current.metricKeys.add(objectiveMetric(row.objective).key);
      map.set(name, current);
    }
    const totalSpend = [...map.values()].reduce((sum, group) => sum + group.rows.reduce((s, row) => s + row.spend, 0), 0);
    return [...map.entries()]
      .map(([name, group]) => {
        const spend = group.rows.reduce((sum, row) => sum + row.spend, 0);
        const inbox = group.rows.reduce((sum, row) => sum + row.inbox, 0);
        const leads = group.rows.reduce((sum, row) => sum + row.leads, 0);
        const impressions = group.rows.reduce((sum, row) => sum + row.impressions, 0);
        const metricKey = group.metricKeys.size === 1 ? [...group.metricKeys][0] : "unknown";
        const sampleValue = metricKey === "leads" ? leads : metricKey === "inbox" ? inbox : 0;
        const result = decisionForBranch({ inbox, leads, objectiveKnown: group.objectiveKnown, objectiveCount: group.objectives.size, objectiveMetric: metricKey as "inbox" | "leads" | "clicks" | "impressions" | "unknown", cpi: inbox > 0 ? spend / inbox : null, cpl: leads > 0 ? spend / leads : null });
        return { name, spend, inbox, leads, impressions, cpi: inbox > 0 ? spend / inbox : null, cpl: leads > 0 ? spend / leads : null, share: totalSpend > 0 ? spend / totalSpend : 0, objectiveLabel: group.objectives.size > 1 ? "หลาย Objective" : [...group.objectives][0] || "ไม่ทราบ Objective", sampleLabel: metricKey === "leads" ? "Lead" : metricKey === "inbox" ? "Inbox" : "ผลลัพธ์ที่ต้องแยกดู", sampleValue, ...result };
      })
      .sort((a, b) => b.spend - a.spend)
      .slice(0, 30);
  }, [filteredInsights, report]);

  const topProgram = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of filteredInsights) {
      const name = row.parsed.program || row.parsed.programCode || "ไม่ระบุ";
      map.set(name, (map.get(name) || 0) + row.spend);
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1])[0];
  }, [filteredInsights]);

  const topCreative = useMemo(() => {
    const map = new Map<string, { spend: number; inbox: number; leads: number }>();
    for (const row of filteredInsights) {
      const name = row.parsed.awCode || row.adName;
      const current = map.get(name) || { spend: 0, inbox: 0, leads: 0 };
      current.spend += row.spend;
      current.inbox += row.inbox;
      current.leads += row.leads;
      map.set(name, current);
    }
    return [...map.entries()].sort((a, b) => b[1].spend - a[1].spend).slice(0, 5);
  }, [filteredInsights]);

  const exportDailySeries = useMemo<DailyReportingRow[]>(() => {
    if (!report) return [];
    if (objectiveFilter === "ALL") return report.dailySeries;
    const byDate = new Map<string, AdInsight[]>();
    for (const row of filteredInsights) {
      const date = row.date;
      if (!date) continue;
      const rows = byDate.get(date) || [];
      rows.push(row);
      byDate.set(date, rows);
    }
    return [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, rows]) => ({ date, ...sumReportingRows(rows) }));
  }, [filteredInsights, objectiveFilter, report]);

  const maxDailySpend = Math.max(...(exportDailySeries || []).map((row) => row.spend), 1);
  const totalChange = report ? pctChange(report.totals.spend, report.previousTotals.spend) : null;
  const resultChange = report ? pctChange(report.totals.inbox + report.totals.leads, report.previousTotals.inbox + report.previousTotals.leads) : null;

  const exportCsv = () => {
    if (!report) return;
    const csv = buildReportCsv(
      {
        snapshotId: report.snapshotId,
        periodSince: report.periods.current.since,
        periodUntil: report.periods.current.until,
        comparisonSince: report.periods.comparison.since,
        comparisonUntil: report.periods.comparison.until,
        objective: objectiveFilter,
        timezone: report.periods.timezone,
        asOf: report.asOf,
        generatedAt: report.generatedAt,
        coverage: `${report.coverage.accountsComplete}/${report.coverage.accountsTotal} accounts, ${report.coverage.failureCount} failures`,
        confidence: report.objectiveBreakdown.map((item) => `${item.objective}:${item.confidence.level}`).join(" | ") || "ยังไม่มีข้อมูล",
      },
      branchSummaries,
      exportDailySeries
    );
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `management-report-${report.periods.current.since}-${report.periods.current.until}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <main className="management-report min-h-screen bg-gray-950 text-white">
      <header className="border-b border-gray-800 bg-gray-900 px-4 py-4 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5 text-indigo-400" />
              <h1 className="text-xl font-bold">Management Report</h1>
              <span className="rounded-full border border-emerald-700/60 bg-emerald-950/40 px-2 py-0.5 text-[10px] text-emerald-300">Read only</span>
            </div>
            <p className="mt-1 text-xs text-slate-400">รายงานเพื่อช่วยตัดสินใจ ไม่ใช่คำสั่งเพิ่มงบอัตโนมัติ</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link href="/" className="rounded-lg bg-slate-800 px-3 py-2 text-xs text-slate-200 hover:bg-slate-700">Dashboard</Link>
            <div className="flex gap-1 overflow-x-auto rounded-lg bg-slate-800 p-1">
              {PERIODS.map((item) => (
                <button key={item.value} onClick={() => { setLoading(true); setPeriod(item.value); }} className={`rounded-md px-3 py-1.5 text-xs font-medium ${period === item.value ? "bg-indigo-600 text-white" : "text-slate-400 hover:text-white"}`}>
                  {item.label}
                </button>
              ))}
            </div>
            <button onClick={() => load(true)} disabled={refreshing} className="flex items-center gap-2 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-medium hover:bg-indigo-500 disabled:opacity-50">
              <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} /> รีเฟรช
            </button>
            <button onClick={exportCsv} disabled={!report} data-export-control className="flex items-center gap-2 rounded-lg bg-slate-800 px-3 py-2 text-xs font-medium text-slate-200 hover:bg-slate-700 disabled:opacity-50"><Download className="h-3.5 w-3.5" /> CSV</button>
            <button onClick={() => window.print()} disabled={!report} data-export-control className="flex items-center gap-2 rounded-lg bg-slate-800 px-3 py-2 text-xs font-medium text-slate-200 hover:bg-slate-700 disabled:opacity-50"><Printer className="h-3.5 w-3.5" /> พิมพ์/PDF</button>
            <LogoutButton />
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-[1600px] space-y-5 p-4 sm:p-6">
        {error && <div className="rounded-xl border border-rose-700/60 bg-rose-950/30 px-4 py-3 text-sm text-rose-200">❌ {error}</div>}
        {loading && !report ? (
          <div className="flex min-h-[360px] items-center justify-center text-slate-400"><RefreshCw className="mr-2 h-5 w-5 animate-spin" />กำลังสร้างรายงาน...</div>
        ) : report ? (
          <>
            <section className="rounded-2xl border border-indigo-700/30 bg-indigo-950/20 p-4 sm:p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-indigo-300">Executive Brief</p>
                  <h2 className="mt-2 text-lg font-semibold text-white">ภาพรวมช่วง{PERIODS.find((item) => item.value === period)?.label}</h2>
                  <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">
                    ใช้งบ {fmtMoney(report.totals.spend)} และได้ Inbox {fmtNumber(report.totals.inbox)} / Lead {fmtNumber(report.totals.leads)}
                    {totalChange == null ? " ยังไม่มีช่วงก่อนหน้าให้เทียบ" : report.periods.current.isPartial ? ` โดยเป็นยอดสะสมบางส่วน (เปลี่ยน ${totalChange.toFixed(1)}% เทียบเวลาเดียวกัน)` : totalChange >= 0 ? ` โดยงบเพิ่ม ${totalChange.toFixed(1)}%` : ` โดยงบลด ${Math.abs(totalChange).toFixed(1)}%`}
                    {resultChange == null ? "" : report.periods.current.isPartial ? " และผลลัพธ์ยังไม่ควรสรุปจนจบวัน" : resultChange >= 0 ? ` และผลลัพธ์รวมเพิ่ม ${resultChange.toFixed(1)}%` : ` แต่ผลลัพธ์รวมลด ${Math.abs(resultChange).toFixed(1)}%`}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1 text-xs text-slate-300"><div className="flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900/70 px-3 py-2"><Clock3 className="h-3.5 w-3.5 text-slate-400" /> As-of {new Date(report.asOf).toLocaleString("th-TH", { timeZone: "Asia/Bangkok" })}</div><p className="text-[10px] text-slate-500">ช่วงนี้ {report.periods.current.since} ถึง {report.periods.current.until}</p><p className="text-[10px] text-slate-500">เทียบ {report.periods.comparison.since} ถึง {report.periods.comparison.until}</p><p className="print-snapshot hidden text-[10px] text-slate-500">Snapshot: {report.snapshotId}</p></div>
              </div>
              <div className="mt-4 flex flex-wrap gap-2 text-[11px] text-amber-200">
                {report.periods.notes.map((note) => <span key={note} className="rounded-full border border-amber-700/40 bg-amber-950/30 px-3 py-1">⚠️ {note}</span>)}
                <span className="rounded-full border border-slate-700 bg-slate-900/60 px-3 py-1">Lead = สัญญาณการจองจาก Meta ไม่ใช่ยอดปิดการขายจาก CRM</span>
              </div>
            </section>

            <section className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-800 bg-slate-900/60 p-3 text-xs"><span className="font-medium text-slate-300">ดู Objective:</span>{objectiveOptions.map((objective) => <button key={objective} onClick={() => setObjectiveFilter(objective)} className={`rounded-md border px-2.5 py-1.5 ${objectiveFilter === objective ? "border-indigo-500 bg-indigo-600 text-white" : "border-slate-700 text-slate-400 hover:text-white"}`}>{objectiveLabel(objective)}</button>)}<span className="text-slate-500">เลือก Objective ก่อนใช้ Decision Board จัดอันดับ</span></section>

            <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <MetricCard label="ยอดใช้จ่าย" value={fmtMoney(report.totals.spend)} change={totalChange} partial={report.periods.current.isPartial} tone="emerald" />
              <MetricCard label="Inbox" value={fmtNumber(report.totals.inbox)} change={pctChange(report.totals.inbox, report.previousTotals.inbox)} partial={report.periods.current.isPartial} tone="purple" />
              <MetricCard label="CPI" value={fmtMoney(report.totals.cpi)} change={pctChange(report.totals.cpi || 0, report.previousTotals.cpi || 0)} tone="amber" />
              <MetricCard label="Lead / CPL" value={`${fmtNumber(report.totals.leads)} / ${fmtMoney(report.totals.cpl)}`} change={pctChange(report.totals.leads, report.previousTotals.leads)} partial={report.periods.current.isPartial} tone="pink" />
            </section>

            <section className="grid gap-5 lg:grid-cols-[1.45fr_1fr]">
              <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4 sm:p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div><p className="text-xs font-semibold uppercase tracking-wider text-indigo-300">Decision Board</p><h2 className="mt-1 text-lg font-semibold">ควรดูอะไรต่อ</h2></div>
                  <div className="flex items-center gap-2"><Target className="h-4 w-4 text-amber-300" /><span className="text-xs text-slate-400">CPI ≤ ฿{CPI_TARGET} · CPL ฿{CPL_TARGET_MIN}–฿{CPL_TARGET_MAX}</span></div>
                </div>
                <div className="mt-4 space-y-3">
                  {branchSummaries.slice(0, 8).map((branch) => (
                    <div key={branch.name} className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div><p className="font-medium text-white">{branch.name}</p><p className="mt-1 text-xs text-slate-500">Spend {fmtMoney(branch.spend)} · Share {(branch.share * 100).toFixed(1)}% · Objective {branch.objectiveLabel} · Sample {fmtNumber(branch.sampleValue)} {branch.sampleLabel}</p></div>
                        <span className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${decisionClass(branch.decision)}`}>{branch.decision}</span>
                      </div>
                      <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-slate-300 sm:grid-cols-4"><span>Inbox <b className="text-white">{fmtNumber(branch.inbox)}</b></span><span>Lead <b className="text-white">{fmtNumber(branch.leads)}</b></span><span>CPI <b className="text-amber-300">{fmtMoney(branch.cpi)}</b></span><span>CPL <b className="text-pink-300">{fmtMoney(branch.cpl)}</b></span></div>
                      <p className="mt-2 text-[11px] text-slate-400">Confidence {branch.confidence} · {branch.reason}</p>
                    </div>
                  ))}
                  {branchSummaries.length === 0 && <p className="py-8 text-center text-sm text-slate-500">ยังไม่มีข้อมูลสาขาที่ใช้จัดอันดับ</p>}
                </div>
              </div>

              <div className="space-y-5">
                <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4 sm:p-5">
                  <div className="flex items-center justify-between"><div><p className="text-xs font-semibold uppercase tracking-wider text-emerald-300">Budget Pacing</p><h2 className="mt-1 text-lg font-semibold">การใช้จ่ายเทียบเวลา</h2></div><Gauge className="h-5 w-5 text-emerald-300" /></div>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2"><div className="rounded-xl bg-slate-950/60 p-3"><p className="text-xs text-slate-500">Daily budget</p><p className="mt-1 text-lg font-semibold text-white">{formatPacing(report.pacing.daily)}</p><p className="mt-1 text-xs text-slate-400">ใช้ไป {fmtMoney(report.pacing.daily.spent)} / {fmtMoney(report.pacing.daily.budget)}</p></div><div className="rounded-xl bg-slate-950/60 p-3"><p className="text-xs text-slate-500">Lifetime budget</p><p className="mt-1 text-lg font-semibold text-white">{formatPacing(report.pacing.lifetime)}</p><p className="mt-1 text-xs text-slate-400">ใช้ไป {fmtMoney(report.pacing.lifetime.spent)} / {fmtMoney(report.pacing.lifetime.budget)}</p></div></div>
                  <p className="mt-3 text-[11px] text-amber-200">{report.pacing.note}</p>
                </div>
                <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4 sm:p-5"><div className="flex items-center justify-between"><div><p className="text-xs font-semibold uppercase tracking-wider text-sky-300">Data Health</p><h2 className="mt-1 text-lg font-semibold">ข้อมูลน่าเชื่อถือแค่ไหน</h2></div><ShieldCheck className="h-5 w-5 text-sky-300" /></div><div className="mt-4 grid grid-cols-2 gap-3 text-sm"><div><p className="text-xs text-slate-500">Account ครบ</p><p className="mt-1 font-semibold text-white">{report.coverage.accountsComplete}/{report.coverage.accountsTotal}</p></div><div><p className="text-xs text-slate-500">Rows ที่อ่านได้</p><p className="mt-1 font-semibold text-white">{fmtNumber(report.coverage.rows)}</p></div><div><p className="text-xs text-slate-500">จัดกลุ่มไม่ได้</p><p className="mt-1 font-semibold text-amber-300">{fmtNumber(report.coverage.unknownRows)}</p></div><div><p className="text-xs text-slate-500">Failure</p><p className="mt-1 font-semibold text-rose-300">{fmtNumber(report.coverage.failureCount)}</p></div></div>{report.coverage.complete ? <p className="mt-3 flex items-center gap-1 text-xs text-emerald-300"><CheckCircle2 className="h-3.5 w-3.5" /> ดึงข้อมูลครบตามที่ระบบรายงาน</p> : <p className="mt-3 flex items-center gap-1 text-xs text-rose-300"><AlertTriangle className="h-3.5 w-3.5" /> มีข้อมูลบางส่วนที่ต้องตรวจ</p>}</div>
              </div>
            </section>

            <section className="grid gap-5 lg:grid-cols-[1.2fr_1fr]">
              <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4 sm:p-5"><div className="flex items-center justify-between"><div><p className="text-xs font-semibold uppercase tracking-wider text-violet-300">Branch Scorecard</p><h2 className="mt-1 text-lg font-semibold">สาขาที่ใช้จ่ายสูงสุด</h2></div><Activity className="h-5 w-5 text-violet-300" /></div><div className="mt-4 overflow-x-auto"><table className="w-full min-w-[920px] text-left text-xs"><thead className="border-b border-slate-800 text-slate-500"><tr><th className="px-2 py-2">สาขา</th><th className="px-2 py-2">Objective</th><th className="px-2 py-2">Sample</th><th className="px-2 py-2 text-right">Spend</th><th className="px-2 py-2 text-right">Share</th><th className="px-2 py-2 text-right">Inbox</th><th className="px-2 py-2 text-right">Lead</th><th className="px-2 py-2 text-right">CPI</th><th className="px-2 py-2 text-right">CPL</th></tr></thead><tbody>{branchSummaries.map((branch) => <tr key={branch.name} className="border-b border-slate-800/70"><td className="px-2 py-2 font-medium text-white">{branch.name}</td><td className="px-2 py-2 text-slate-400">{branch.objectiveLabel}</td><td className="px-2 py-2 text-slate-400">{fmtNumber(branch.sampleValue)} {branch.sampleLabel}</td><td className="px-2 py-2 text-right text-emerald-300">{fmtMoney(branch.spend)}</td><td className="px-2 py-2 text-right text-slate-300">{(branch.share * 100).toFixed(1)}%</td><td className="px-2 py-2 text-right text-violet-300">{fmtNumber(branch.inbox)}</td><td className="px-2 py-2 text-right text-blue-300">{fmtNumber(branch.leads)}</td><td className="px-2 py-2 text-right text-amber-300">{fmtMoney(branch.cpi)}</td><td className="px-2 py-2 text-right text-pink-300">{fmtMoney(branch.cpl)}</td></tr>)}</tbody></table></div></div>
              <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4 sm:p-5"><div className="flex items-center justify-between"><div><p className="text-xs font-semibold uppercase tracking-wider text-fuchsia-300">Funnel</p><h2 className="mt-1 text-lg font-semibold">Impression → Click → Inbox → Lead</h2></div><TrendingUp className="h-5 w-5 text-fuchsia-300" /></div><div className="mt-4 space-y-3">{[["Impression", report.totals.impressions, "text-slate-200"], ["Click", report.totals.clicks, "text-sky-300"], ["Inbox", report.totals.inbox, "text-violet-300"], ["Lead", report.totals.leads, "text-pink-300"]].map(([label, value, color]) => <div key={String(label)}><div className="flex justify-between text-xs"><span className="text-slate-400">{label}</span><span className={String(color)}>{fmtNumber(Number(value))}</span></div><div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-800"><div className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-fuchsia-500" style={{ width: `${Math.max(2, Math.min(100, (Number(value) / Math.max(report.totals.impressions, 1)) * 100))}%` }} /></div></div>)}</div></div>
            </section>

            <section className="grid gap-5 lg:grid-cols-[1.25fr_1fr]">
              <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4 sm:p-5"><div className="flex flex-wrap items-center justify-between gap-2"><div><p className="text-xs font-semibold uppercase tracking-wider text-cyan-300">Daily Trend</p><h2 className="mt-1 text-lg font-semibold">ยอดใช้จ่ายรายวัน</h2></div><div className="flex gap-1 overflow-x-auto rounded-lg bg-slate-800 p-1">{objectiveOptions.slice(0, 8).map((objective) => <button key={objective} onClick={() => setObjectiveFilter(objective)} className={`rounded px-2 py-1 text-[10px] ${objectiveFilter === objective ? "bg-indigo-600 text-white" : "text-slate-400"}`}>{objectiveLabel(objective)}</button>)}</div></div><div className="mt-4 space-y-2">{exportDailySeries.map((day) => <div key={day.date} className="grid grid-cols-[75px_1fr_70px] items-center gap-2 text-xs"><span className="text-slate-500">{day.date.slice(5)}</span><div className="h-2 overflow-hidden rounded-full bg-slate-800"><div className="h-full rounded-full bg-cyan-500" style={{ width: `${(day.spend / maxDailySpend) * 100}%` }} /></div><span className="text-right text-emerald-300">{fmtMoney(day.spend)}</span></div>)}{exportDailySeries.length === 0 && <p className="py-8 text-center text-sm text-slate-500">ไม่มี Daily data</p>}</div></div>
              <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4 sm:p-5"><div className="flex items-center justify-between"><div><p className="text-xs font-semibold uppercase tracking-wider text-amber-300">Creative / Program signal</p><h2 className="mt-1 text-lg font-semibold">สิ่งที่ควรเปิดดูต่อ</h2></div><TrendingDown className="h-5 w-5 text-amber-300" /></div><p className="mt-4 text-xs text-slate-400">Program ที่ใช้จ่ายสูงสุด</p><p className="mt-1 text-xl font-semibold text-white">{topProgram ? `${topProgram[0]} · ${fmtMoney(topProgram[1])}` : "ไม่มีข้อมูล"}</p><p className="mt-4 text-xs text-slate-400">Creative ที่ใช้จ่ายสูงสุด (ยังไม่ใช่ Best)</p><div className="mt-2 space-y-2">{topCreative.map(([name, value]) => <div key={name} className="flex items-center justify-between gap-2 rounded-lg bg-slate-950/60 px-3 py-2 text-xs"><span className="truncate text-slate-300">{name}</span><span className="shrink-0 text-emerald-300">{fmtMoney(value.spend)}</span></div>)}</div><p className="mt-3 text-[11px] text-amber-200">รายการนี้เรียงตาม Spend เท่านั้น ไม่สรุปว่าเป็น Creative ที่ดีที่สุดจนกว่าจะมี Sample และ Confidence เพียงพอ</p></div>
            </section>

            {report.failures.length > 0 && <section className="rounded-xl border border-amber-700/50 bg-amber-950/20 p-4 text-sm text-amber-200"><div className="flex items-center gap-2 font-medium"><AlertTriangle className="h-4 w-4" /> ดึงข้อมูลไม่ครบ {report.failures.length} รายการ</div><ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-amber-300">{report.failures.slice(0, 8).map((failure, index) => <li key={`${failure.accountId || failure.scope}-${index}`}>{failure.accountName || failure.accountId || failure.scope} — {failure.message}</li>)}</ul></section>}
          </>
        ) : null}
      </div>
    </main>
  );
}
