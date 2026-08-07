"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import { RefreshCw, AlertTriangle, MapPin, Layers, Gauge, Target, Settings2, BarChart3, ClipboardList, ChevronDown } from "lucide-react";
import Link from "next/link";
import DateRangePicker from "@/components/DateRangePicker";
import { BRANCH_MAP, PROGRAM_MAP } from "@/lib/parser";
import type { AdInsight } from "@/lib/meta";
import CreativeGrid from "@/components/CreativeGrid";
import KpiCards from "@/components/KpiCards";
import FilterBar from "@/components/FilterBar";
import SortableMetricTable from "@/components/SortableMetricTable";
import LogoutButton from "@/components/LogoutButton";
import { COLORS } from "./theme";
import type { GroupedRow, TabKey } from "./types";
import { findBestCost } from "@/lib/metrics";
import { flagWastefulCreatives } from "@/lib/budget-guard";

type FetchFailure = {
  scope: string;
  accountId?: string;
  accountName?: string;
  message: string;
  tokenIndex?: number;
  period?: string;
};

const DATE_PRESETS = [
  { label: "วันนี้", value: "today" },
  { label: "เมื่อวาน", value: "yesterday" },
  { label: "7 วัน", value: "last_7d" },
  { label: "30 วัน", value: "last_30d" },
  { label: "เดือนนี้", value: "this_month" },
  { label: "เดือนที่แล้ว", value: "last_month" },
];

const THAI_MONTHS_SHORT = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];

// "2026-08-01".."2026-08-06" → "1–6 ส.ค." / วันเดียว → "6 ส.ค." / ข้ามเดือน → "28 ก.ค. – 3 ส.ค."
function fmtDateRange(since: string, until: string): string {
  const [, ms, ds] = since.split("-").map(Number);
  const [, mu, du] = until.split("-").map(Number);
  if (ms === mu) {
    return ds === du ? `${ds} ${THAI_MONTHS_SHORT[ms - 1]}` : `${ds}–${du} ${THAI_MONTHS_SHORT[ms - 1]}`;
  }
  return `${ds} ${THAI_MONTHS_SHORT[ms - 1]} – ${du} ${THAI_MONTHS_SHORT[mu - 1]}`;
}

function groupBy(insights: AdInsight[], key: TabKey): GroupedRow[] {
  const map: Record<string, GroupedRow> = {};
  for (const ins of insights) {
    let name = "";
    if (key === "branch") name = ins.parsed.branch || ins.parsed.branchCode || "ไม่ระบุ";
    else if (key === "program") name = ins.parsed.program || ins.parsed.programCode || "ไม่ระบุ";
    else if (key === "creative") name = ins.parsed.awCode || "ไม่ระบุ";

    if (!map[name]) map[name] = { name, spend: 0, impressions: 0, inbox: 0, cpi: 0, leads: 0, cpl: 0 };
    map[name].spend += ins.spend;
    map[name].impressions += ins.impressions;
    map[name].inbox += ins.inbox;
    map[name].leads += ins.leads;
  }

  return Object.values(map)
    .map((r) => ({
      ...r,
      cpi: r.inbox > 0 ? r.spend / r.inbox : 0,
      cpl: r.leads > 0 ? r.spend / r.leads : 0,
    }))
    .sort((a, b) => b.spend - a.spend);
}

function groupByWithPrev(insights: AdInsight[], prevInsights: AdInsight[], key: TabKey): GroupedRow[] {
  const map: Record<string, GroupedRow> = {};

  for (const ins of insights) {
    let name = "";
    if (key === "branch") name = ins.parsed.branch || ins.parsed.branchCode || "ไม่ระบุ";
    else if (key === "program") name = ins.parsed.program || ins.parsed.programCode || "ไม่ระบุ";
    else if (key === "creative") name = ins.parsed.awCode || "ไม่ระบุ";

    if (!map[name]) {
      map[name] = { name, spend: 0, impressions: 0, inbox: 0, cpi: 0, leads: 0, cpl: 0, prevSpend: 0, prevImpressions: 0, prevInbox: 0, prevCpi: 0, prevLeads: 0, prevCpl: 0 };
    }
    map[name].spend += ins.spend;
    map[name].impressions += ins.impressions;
    map[name].inbox += ins.inbox;
    map[name].leads += ins.leads;
  }

  for (const ins of prevInsights) {
    let name = "";
    if (key === "branch") name = ins.parsed.branch || ins.parsed.branchCode || "ไม่ระบุ";
    else if (key === "program") name = ins.parsed.program || ins.parsed.programCode || "ไม่ระบุ";
    else if (key === "creative") name = ins.parsed.awCode || "ไม่ระบุ";

    if (!map[name]) {
      map[name] = { name, spend: 0, impressions: 0, inbox: 0, cpi: 0, leads: 0, cpl: 0, prevSpend: 0, prevImpressions: 0, prevInbox: 0, prevCpi: 0, prevLeads: 0, prevCpl: 0 };
    }
    if (map[name].prevSpend === undefined) map[name].prevSpend = 0;
    if (map[name].prevImpressions === undefined) map[name].prevImpressions = 0;
    if (map[name].prevInbox === undefined) map[name].prevInbox = 0;
    if (map[name].prevLeads === undefined) map[name].prevLeads = 0;

    map[name].prevSpend! += ins.spend;
    map[name].prevImpressions! += ins.impressions;
    map[name].prevInbox! += ins.inbox;
    map[name].prevLeads! += ins.leads;
  }

  return Object.values(map)
    .map((r) => ({
      ...r,
      cpi: r.inbox > 0 ? r.spend / r.inbox : 0,
      cpl: r.leads > 0 ? r.spend / r.leads : 0,
      prevCpi: (r.prevInbox || 0) > 0 ? (r.prevSpend || 0) / r.prevInbox! : 0,
      prevCpl: (r.prevLeads || 0) > 0 ? (r.prevSpend || 0) / r.prevLeads! : 0,
    }))
    .sort((a, b) => b.spend - a.spend)
    .slice(0, 50);
}

function fmt(n: number) {
  return n.toLocaleString("th-TH", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}
function fmtB(n: number) {
  if (n >= 1_000_000) return `฿${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `฿${(n / 1_000).toFixed(1)}K`;
  return `฿${n.toFixed(0)}`;
}

export default function Dashboard() {
  const [insights, setInsights] = useState<AdInsight[]>([]);
  const [prevInsights, setPrevInsights] = useState<AdInsight[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [fetchFailures, setFetchFailures] = useState<FetchFailure[]>([]);
  const [serverCacheHit, setServerCacheHit] = useState(false);
  const [datePreset, setDatePreset] = useState("today");
  const [tab, setTab] = useState<TabKey>("branch");
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [showUnparsed, setShowUnparsed] = useState(false);
  const [branchFilter, setBranchFilter] = useState<"all" | "class" | "classgo">("all");
  const [branchNameFilter, setBranchNameFilter] = useState<string>("all");
  const [programFilter, setProgramFilter] = useState<string>("all");
  const [adCodeFilter, setAdCodeFilter] = useState<string>("");
  const [showComparison, setShowComparison] = useState<boolean>(false);
  const [reportPeriods, setReportPeriods] = useState<{
    current: { since: string; until: string };
    comparison: { since: string; until: string };
  } | null>(null);
  const [tableSort, setTableSort] = useState<{ col: string; dir: "asc" | "desc" }>({ col: "spend", dir: "desc" });
  const [customSince, setCustomSince] = useState("");
  const [customUntil, setCustomUntil] = useState("");
  const [excludedBranches, setExcludedBranches] = useState<Set<string>>(new Set());
  const [dynamicBranchCodes, setDynamicBranchCodes] = useState<Set<string>>(new Set());
  const [testBranchNames, setTestBranchNames] = useState<Set<string>>(new Set());
  const [showTestBranches, setShowTestBranches] = useState(false);

  // Load dynamic branch codes (added via /settings) so unknown-branch detection stays in sync
  useEffect(() => {
    fetch("/api/branches")
      .then((res) => res.json())
      .then((data) => {
        if (data?.branches) {
          setDynamicBranchCodes(new Set(Object.keys(data.branches)));
          setTestBranchNames(new Set(
            Object.values(data.branches)
              .filter((entry: unknown) => (entry as { isTest?: boolean }).isTest)
              .map((entry: unknown) => (entry as { name: string }).name)
          ));
        }
      })
      .catch(() => {});
  }, []);

  // Load initial filters from URL Search Params on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const d = params.get("date");
    const t = params.get("tab") as TabKey;
    const bf = params.get("bf") as "all" | "class" | "classgo";
    const bnf = params.get("bnf");
    const pf = params.get("pf");
    const ac = params.get("adcode") || params.get("code");
    const cmp = params.get("compare");

    if (d) setDatePreset(d);
    if (t && ["branch", "program", "creative"].includes(t)) setTab(t);
    if (bf && ["all", "class", "classgo"].includes(bf)) setBranchFilter(bf);
    if (bnf) setBranchNameFilter(bnf);
    if (pf) setProgramFilter(pf);
    if (ac) setAdCodeFilter(ac);
    if (cmp === "1" || cmp === "true") setShowComparison(true);
  }, []);

  // Update URL Search Params when active filters change
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    
    const sync = (key: string, val: string, defaultVal: string) => {
      if (val && val !== defaultVal) {
        params.set(key, val);
      } else {
        params.delete(key);
      }
    };

    sync("date", datePreset, "today");
    sync("tab", tab, "branch");
    sync("bf", branchFilter, "all");
    sync("bnf", branchNameFilter, "all");
    sync("pf", programFilter, "all");
    sync("adcode", adCodeFilter, "");
    sync("compare", showComparison ? "1" : "", "");

    const newSearch = params.toString();
    const currentSearch = window.location.search.replace(/^\?/, "");
    if (newSearch !== currentSearch) {
      const newUrl = `${window.location.pathname}${newSearch ? "?" + newSearch : ""}`;
      window.history.replaceState({ ...window.history.state, as: newUrl, url: newUrl }, "", newUrl);
    }
  }, [datePreset, tab, branchFilter, branchNameFilter, programFilter, adCodeFilter, showComparison]);

  const handleTableSort = (col: string) => {
    setTableSort((prev) => prev.col === col ? { col, dir: prev.dir === "desc" ? "asc" : "desc" } : { col, dir: col === "cpi" || col === "cpl" ? "asc" : "desc" });
  };

  const handleClearFilters = () => {
    setBranchFilter("all");
    setBranchNameFilter("all");
    setProgramFilter("all");
    setAdCodeFilter("");
    setExcludedBranches(new Set());
  };

  const staleReloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // ให้ timer เรียก load เวอร์ชันล่าสุดเสมอ (เลี่ยงการอ้างถึงตัวเองใน useCallback)
  const loadRef = useRef<(force?: boolean, overrideDates?: { since: string; until: string }) => void>(() => {});

  const load = useCallback(async (force = false, overrideDates?: { since: string; until: string }) => {
    const effectiveSince = overrideDates?.since ?? customSince;
    const effectiveUntil = overrideDates?.until ?? customUntil;

    // overrideDates มาจากปุ่มค้นหาช่วงกำหนดเอง — ต้องถือเป็น custom ทันที
    // เพราะตอนนั้น setDatePreset("custom") ยังไม่ทันมีผลใน closure นี้
    // (ไม่งั้นจะยิง preset เก่าแบบ force refresh แทนช่วงที่เลือก)
    const isCustom = datePreset === "custom" || overrideDates !== undefined;

    // For custom mode, require both dates
    if (isCustom && (!effectiveSince || !effectiveUntil)) return;

    const cacheKey = isCustom ? `insights_custom_${effectiveSince}_${effectiveUntil}` : `insights_${datePreset}`;
    if (!force) {
      try {
        const cached = sessionStorage.getItem(cacheKey);
        if (cached) {
          const { data, prevData, failures, fetchedAt, periods, ts } = JSON.parse(cached);
          if (Date.now() - ts < 15 * 60 * 1000) {
            setInsights(data || []);
            setPrevInsights(prevData || []);
            setFetchFailures(failures || []);
            if (periods?.current && periods?.comparison) setReportPeriods({ current: periods.current, comparison: periods.comparison });
            setServerCacheHit(true);
            setLastUpdated(new Date(fetchedAt || ts));
            return;
          }
        }
      } catch {}
    }
    setLoading(true);
    setError("");
    setFetchFailures([]);
    setServerCacheHit(false);
    try {
      let url: string;
      if (isCustom) {
        url = `/api/insights?since=${effectiveSince}&until=${effectiveUntil}`;
      } else {
        url = `/api/insights?date_preset=${datePreset}`;
      }
      if (force) url += `${url.includes("?") ? "&" : "?"}refresh=1`;
      const res = await fetch(url);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      const current = data.insights || [];
      const prev = data.previousInsights || [];
      const failures: FetchFailure[] = data.failures || [];
      const fetchedAt = data.cache?.fetchedAt || new Date().toISOString();
      setInsights(current);
      setPrevInsights(prev);
      setFetchFailures(failures);
      if (data.periods?.current && data.periods?.comparison) setReportPeriods({ current: data.periods.current, comparison: data.periods.comparison });
      setServerCacheHit(Boolean(data.cache?.hit));
      setLastUpdated(new Date(fetchedAt));
      if (data.cache?.dataStale) {
        // server เสิร์ฟตัวเลขเก่าไปก่อนแล้วกำลัง sync เบื้องหลัง — อย่าเก็บลง cache ฝั่งเรา
        // และแวะโหลดซ้ำเงียบๆ อีกครั้งเพื่อรับตัวเลขที่อัปเดตแล้ว
        if (staleReloadTimer.current) clearTimeout(staleReloadTimer.current);
        staleReloadTimer.current = setTimeout(() => loadRef.current(false, overrideDates), 90_000);
      } else {
        try {
          sessionStorage.setItem(cacheKey, JSON.stringify({ data: current, prevData: prev, failures, fetchedAt, periods: data.periods, ts: Date.now() }));
        } catch {}
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "เกิดข้อผิดพลาด");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [datePreset, customSince, customUntil]);

  useEffect(() => {
    loadRef.current = load;
  }, [load]);

  useEffect(() => {
    // For custom mode, don't auto-load — require explicit "ค้นหา" click
    if (datePreset === "custom") return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load, datePreset]);

  const unparsedInsights = insights.filter((i) => !i.parsed.isParsed);

  // Unknown branch codes — parsed OK but branchCode not in BRANCH_MAP
  const unknownBranches = (() => {
    const map: Record<string, { spend: number; example: string }> = {};
    for (const i of insights) {
      const bc = i.parsed.branchCode;
      if (bc && !BRANCH_MAP[bc] && !dynamicBranchCodes.has(bc) && !['IG', 'หน้าบ้าน'].includes(bc)) {
        if (!map[bc]) map[bc] = { spend: 0, example: i.adName };
        map[bc].spend += i.spend;
      }
    }
    return Object.entries(map).sort((a, b) => b[1].spend - a[1].spend);
  })();

  /* ── budget waste guard: ธงรายชิ้นครีเอทีฟที่กำลังเผาเงิน ── */
  // คิดจากข้อมูลเต็ม (ตัดแค่สาขาเทส) — ไม่โดน filter ของ user บังจนวิกฤตหลุดสายตา
  const wasteful = useMemo(
    () => flagWastefulCreatives(insights.filter((i) => !testBranchNames.has(i.parsed.branch || ""))),
    [insights, testBranchNames]
  );
  const criticalWaste = wasteful.filter((w) => w.flag.level === "kill");
  const warningWaste = wasteful.filter((w) => w.flag.level === "warning");
  const [showWarningWaste, setShowWarningWaste] = useState(false);
  const [showAllCritical, setShowAllCritical] = useState(false);
  const [criticalPanelCollapsed, setCriticalPanelCollapsed] = useState(false);

  const filterByAdCode = (i: AdInsight) => {
    if (!adCodeFilter.trim()) return true;
    const q = adCodeFilter.trim().toLowerCase();
    const aw = (i.parsed.awCode || "").toLowerCase();
    const cid = (i.parsed.creativeId || "").toLowerCase();
    const name = (i.adName || "").toLowerCase();
    const sc = (i.parsed.serviceCode || "").toLowerCase();
    return aw.includes(q) || cid.includes(q) || name.includes(q) || sc.includes(q);
  };

  const filteredInsights = insights.filter((i) => {
    const b = i.parsed.branch || "";
    if (!filterByAdCode(i)) return false;
    // Exclude user-hidden branches
    if (excludedBranches.size > 0 && excludedBranches.has(b)) return false;
    if (!showTestBranches && testBranchNames.has(b)) return false;
    if (tab === "branch") {
      if (branchFilter === "classgo" && !b.startsWith("Class Go")) return false;
      if (branchFilter === "class" && b.startsWith("Class Go")) return false;
      if (programFilter !== "all" && i.parsed.programCode !== programFilter) return false;
    }
    if (tab === "program") {
      if (branchFilter === "classgo" && !b.startsWith("Class Go")) return false;
      if (branchFilter === "class" && b.startsWith("Class Go")) return false;
      if (branchNameFilter !== "all" && b !== branchNameFilter) return false;
    }
    if (tab === "creative") {
      if (branchFilter === "classgo" && !b.startsWith("Class Go")) return false;
      if (branchFilter === "class" && b.startsWith("Class Go")) return false;
      if (branchNameFilter !== "all" && b !== branchNameFilter) return false;
      if (programFilter !== "all" && i.parsed.programCode !== programFilter) return false;
    }
    return true;
  });

  const filteredPrevInsights = prevInsights.filter((i) => {
    const b = i.parsed.branch || "";
    if (!filterByAdCode(i)) return false;
    // Exclude user-hidden branches
    if (excludedBranches.size > 0 && excludedBranches.has(b)) return false;
    if (!showTestBranches && testBranchNames.has(b)) return false;
    if (tab === "branch") {
      if (branchFilter === "classgo" && !b.startsWith("Class Go")) return false;
      if (branchFilter === "class" && b.startsWith("Class Go")) return false;
      if (programFilter !== "all" && i.parsed.programCode !== programFilter) return false;
    }
    if (tab === "program") {
      if (branchFilter === "classgo" && !b.startsWith("Class Go")) return false;
      if (branchFilter === "class" && b.startsWith("Class Go")) return false;
      if (branchNameFilter !== "all" && b !== branchNameFilter) return false;
    }
    if (tab === "creative") {
      if (branchFilter === "classgo" && !b.startsWith("Class Go")) return false;
      if (branchFilter === "class" && b.startsWith("Class Go")) return false;
      if (branchNameFilter !== "all" && b !== branchNameFilter) return false;
      if (programFilter !== "all" && i.parsed.programCode !== programFilter) return false;
    }
    return true;
  });


  const programOptions = [...new Set(insights.map((i) => i.parsed.programCode).filter(Boolean))]
    .sort()
    .map((code) => ({ code, label: PROGRAM_MAP[code] || code }));

  const branchOptionsAll = [...new Set(insights.map((i) => i.parsed.branch).filter(Boolean))]
    .filter((b) => showTestBranches || !testBranchNames.has(b))
    .sort();
  const branchOptions = branchOptionsAll.filter((b) => {
    if (branchFilter === "classgo") return b.startsWith("Class Go");
    if (branchFilter === "class") return !b.startsWith("Class Go");
    return true;
  });

  // Summary highlights
  const topBranch = (() => {
    const m: Record<string, number> = {};
    filteredInsights.forEach((i) => {
      const b = i.parsed.branch || i.parsed.branchCode || "ไม่ระบุ";
      m[b] = (m[b] || 0) + i.spend;
    });
    const entries = Object.entries(m).sort((a, b) => b[1] - a[1]);
    return entries[0] ? { name: entries[0][0], spend: entries[0][1] } : null;
  })();

  const topProgram = (() => {
    const m: Record<string, number> = {};
    filteredInsights.forEach((i) => {
      const p = i.parsed.program || i.parsed.programCode || "ไม่ระบุ";
      m[p] = (m[p] || 0) + i.spend;
    });
    const entries = Object.entries(m).sort((a, b) => b[1] - a[1]);
    return entries[0] ? { name: entries[0][0], spend: entries[0][1] } : null;
  })();

  const costRows = filteredInsights.map((i) => ({
    name: i.parsed.awCode || i.adName,
    spend: i.spend,
    inbox: i.inbox,
    leads: i.leads,
  }));
  const bestCPI = findBestCost(costRows, "inbox");
  const bestCPL = findBestCost(costRows, "leads");

  const rawChartData = groupByWithPrev(filteredInsights, filteredPrevInsights, tab);
  const chartData = [...rawChartData].sort((a, b) => {
    const col = tableSort.col as keyof GroupedRow;
    const av = col === "name" ? (a.name as string) : (a[col] as number) ?? 0;
    const bv = col === "name" ? (b.name as string) : (b[col] as number) ?? 0;
    if (col === "cpi" || col === "cpl") {
      const an = col === "cpi" ? (a.inbox > 0 ? a.cpi : Infinity) : (a.leads > 0 ? a.cpl : Infinity);
      const bn = col === "cpi" ? (b.inbox > 0 ? b.cpi : Infinity) : (b.leads > 0 ? b.cpl : Infinity);
      return tableSort.dir === "asc" ? an - bn : bn - an;
    }
    if (typeof av === "string") return tableSort.dir === "asc" ? av.localeCompare(bv as string) : (bv as string).localeCompare(av);
    return tableSort.dir === "asc" ? (av as number) - (bv as number) : (bv as number) - (av as number);
  }).slice(0, 50);

  const tabs: { key: TabKey; label: string }[] = [
    { key: "branch", label: "สาขา" },
    { key: "program", label: "โปรแกรม" },
    { key: "creative", label: "Creative" },
  ];

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* Header */}
      <div className="border-b border-gray-800 bg-gray-900 px-4 sm:px-6 py-3 sm:py-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-xl font-bold text-white flex items-center gap-2">
              Meta Ads Dashboard
              {reportPeriods && (
                <span className="text-xs font-normal text-amber-300/90 bg-amber-950/60 border border-amber-800/60 px-2.5 py-0.5 rounded-full">
                  {fmtDateRange(reportPeriods.current.since, reportPeriods.current.until)} เทียบ{" "}
                  {fmtDateRange(reportPeriods.comparison.since, reportPeriods.comparison.until)}
                </span>
              )}
            </h1>
            {lastUpdated && (
              <p className="text-xs text-gray-400 mt-0.5">
                อัปเดตข้อมูล: {lastUpdated.toLocaleTimeString("th-TH", { timeZone: "Asia/Bangkok" })}
                {serverCacheHit && <span className="text-slate-500"> (จาก cache)</span>}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2 sm:gap-3 flex-wrap justify-end">
            {/* Date preset */}
            <div className="flex gap-1 bg-gray-800 rounded-lg p-1 overflow-x-auto">
              {DATE_PRESETS.map((d) => (
                <button
                  key={d.value}
                  onClick={() => setDatePreset(d.value)}
                  className={`px-2.5 sm:px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                    datePreset === d.value && datePreset !== "custom"
                      ? "bg-indigo-600 text-white"
                      : "text-gray-400 hover:text-white"
                  }`}
                >
                  {d.label}
                </button>
              ))}
            </div>
            <DateRangePicker
              since={customSince}
              until={customUntil}
              onApply={(s, u) => {
                setDatePreset("custom");
                setCustomSince(s);
                setCustomUntil(u);
                // ไม่ force — ให้ server ตัดสินความสดเอง (ข้อมูลที่ sync แล้วตอบใน 1-3 วิ)
                load(false, { since: s, until: u });
              }}
            />
            <button
              onClick={() => load(true)}
              disabled={loading}
              className="flex items-center gap-2 px-3 sm:px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded-lg text-sm font-medium transition-colors"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
              {loading ? "กำลังโหลด..." : "รีเฟรช"}
            </button>
            <Link
              href="/management"
              className="flex items-center gap-2 px-3 sm:px-4 py-2 bg-indigo-600/20 hover:bg-indigo-600/30 border border-indigo-500/40 rounded-lg text-sm text-indigo-200 transition-colors"
              title="รายงานผู้บริหาร"
            >
              <BarChart3 className="w-4 h-4" />
              <span className="hidden sm:inline">รายงานผู้บริหาร</span>
            </Link>
            <Link
              href="/creative-review"
              className="flex items-center gap-2 px-3 sm:px-4 py-2 bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/40 rounded-lg text-sm text-emerald-200 transition-colors"
              title="ตรวจสอบคอนเทนท์ก่อนขึ้นแอด"
            >
              <ClipboardList className="w-4 h-4" />
              <span className="hidden sm:inline">ตรวจคอนเทนท์</span>
            </Link>
            <Link
              href="/settings"
              className="flex items-center gap-2 px-3 sm:px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-sm text-gray-300 transition-colors"
              title="ตั้งค่าสาขา"
            >
              <Settings2 className="w-4 h-4" />
              <span className="hidden sm:inline">ตั้งค่า</span>
            </Link>
            <LogoutButton />
          </div>
        </div>
      </div>

      <div className="p-4 sm:p-6 space-y-6">
        {error && (
          <div className="bg-red-900/40 border border-red-700 rounded-lg px-4 py-3 text-red-300 text-sm">
            ❌ {error}
          </div>
        )}

        {/* 🔥 แจ้งเตือนวิกฤต: ชิ้นครีเอทีฟที่กำลังเผาเงิน — ขึ้นก่อนทุกอย่าง */}
        {!loading && criticalWaste.length > 0 && (
          <div className="bg-red-950/40 border-2 border-red-700/70 rounded-xl p-4 sm:p-5">
            <button
              onClick={() => setCriticalPanelCollapsed((v) => !v)}
              className="w-full flex items-center justify-between flex-wrap gap-2 mb-1 text-left"
              aria-expanded={!criticalPanelCollapsed}
            >
              <h2 className="text-sm font-bold text-red-300 flex items-center gap-2">
                <ChevronDown
                  className={`w-4 h-4 text-red-400 flex-shrink-0 transition-transform ${criticalPanelCollapsed ? "-rotate-90" : ""}`}
                />
                <AlertTriangle className="w-4 h-4 text-red-400" />
                วิกฤต: {criticalWaste.length} ชิ้นกำลังเผาเงิน — ควรปิดหรือเปลี่ยนครีเอทีฟทันที
              </h2>
              <span className="text-[11px] text-red-300/70">
                เงินเกินเป้ารวม ~{fmtB(criticalWaste.reduce((s, w) => s + w.excess, 0))} · อิงช่วงเวลาที่เลือก
              </span>
            </button>
            {criticalPanelCollapsed ? null : (
              <>
            <div className="space-y-1.5 mt-2">
              {(showAllCritical ? criticalWaste : criticalWaste.slice(0, 6)).map((w) => (
                <div key={w.groupKey} className="flex items-start gap-2.5 bg-gray-900/70 rounded-lg px-3 py-2">
                  <span className="flex-shrink-0 mt-0.5 px-1.5 py-0.5 rounded text-[10px] font-bold bg-red-600 text-white">
                    ควรปิด
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-gray-100 font-medium">
                      {w.groupKey}
                      <span className="text-gray-400 font-normal">
                        {" "}· {PROGRAM_MAP[w.programCode] || w.programCode}
                        {w.branches.length > 0 && ` · ${w.branches.slice(0, 3).join(", ")}${w.branches.length > 3 ? ` +${w.branches.length - 3}` : ""}`}
                      </span>
                    </p>
                    <p className="text-[11px] text-gray-400">
                      ใช้ไป {fmtB(w.spend)} · Inbox {w.inbox} · CPI {w.inbox > 0 ? fmtB(w.cpi) : "-"} —{" "}
                      <span className="text-red-300">{w.flag.reason}</span>
                    </p>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-4 mt-2">
              {criticalWaste.length > 6 && (
                <button
                  onClick={() => setShowAllCritical((v) => !v)}
                  className="text-[11px] text-red-300/90 hover:text-red-200 underline"
                >
                  {showAllCritical ? "ย่อรายการ" : `ดูวิกฤตอีก ${criticalWaste.length - 6} ชิ้น`}
                </button>
              )}
              {warningWaste.length > 0 && (
                <button
                  onClick={() => setShowWarningWaste((v) => !v)}
                  className="text-[11px] text-amber-300/90 hover:text-amber-200 underline"
                >
                  {showWarningWaste ? "ซ่อนตัวเฝ้าดู" : `เฝ้าดูอีก ${warningWaste.length} ชิ้น`}
                </button>
              )}
            </div>
            {showWarningWaste && (
              <div className="space-y-1.5 mt-2 pt-2 border-t border-red-900/50">
                {warningWaste.map((w) => (
                  <div key={w.groupKey} className="flex items-start gap-2.5 bg-gray-900/50 rounded-lg px-3 py-2">
                    <span className="flex-shrink-0 mt-0.5 px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-600/80 text-white">
                      เฝ้าดู
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs text-gray-200">
                        {w.groupKey}
                        <span className="text-gray-500"> · {PROGRAM_MAP[w.programCode] || w.programCode}</span>
                      </p>
                      <p className="text-[11px] text-gray-500">
                        ใช้ไป {fmtB(w.spend)} · Inbox {w.inbox} · CPI {w.inbox > 0 ? fmtB(w.cpi) : "-"} —{" "}
                        <span className="text-amber-300/80">{w.flag.reason}</span>
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
              </>
            )}
          </div>
        )}
        {/* ไม่มีวิกฤต แต่มีตัวเฝ้าดู — แถบเล็กๆ ไม่รบกวน */}
        {!loading && criticalWaste.length === 0 && warningWaste.length > 0 && (
          <div className="bg-amber-950/25 border border-amber-800/50 rounded-xl px-4 py-2.5">
            <button
              onClick={() => setShowWarningWaste((v) => !v)}
              className="text-xs text-amber-300 hover:text-amber-200 w-full text-left"
            >
              ⚠️ มี {warningWaste.length} ชิ้นที่ควรเฝ้าดู (ยังไม่วิกฤต) — {showWarningWaste ? "ซ่อน" : "กดดูรายละเอียด"}
            </button>
            {showWarningWaste && (
              <div className="space-y-1.5 mt-2">
                {warningWaste.map((w) => (
                  <div key={w.groupKey} className="flex items-start gap-2.5 bg-gray-900/50 rounded-lg px-3 py-2">
                    <span className="flex-shrink-0 mt-0.5 px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-600/80 text-white">
                      เฝ้าดู
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs text-gray-200">
                        {w.groupKey}
                        <span className="text-gray-500"> · {PROGRAM_MAP[w.programCode] || w.programCode}</span>
                      </p>
                      <p className="text-[11px] text-gray-500">
                        ใช้ไป {fmtB(w.spend)} · Inbox {w.inbox} · CPI {w.inbox > 0 ? fmtB(w.cpi) : "-"} —{" "}
                        <span className="text-amber-300/80">{w.flag.reason}</span>
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {fetchFailures.length > 0 && (
          <div className="bg-orange-900/25 border border-orange-700/60 rounded-lg px-4 py-3 text-orange-200 text-sm">
            <p className="font-medium">⚠️ ดึงข้อมูลไม่ครบ {fetchFailures.length} รายการ</p>
            <ul className="mt-1 space-y-0.5 text-xs text-orange-300/90">
              {fetchFailures.map((failure, index) => (
                <li key={`${failure.accountId || failure.scope}-${index}`}>
                  {failure.accountName || failure.accountId || `Token #${failure.tokenIndex || "?"}`} — {failure.message}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Unparsed Ads Dropdown */}
        {unparsedInsights.length > 0 && (
          <div className="bg-yellow-900/20 border border-yellow-700/50 rounded-xl overflow-hidden">
            <button
              onClick={() => setShowUnparsed((v) => !v)}
              className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-yellow-900/30 transition-colors"
            >
              <span className="text-yellow-400 text-sm font-medium">
                ⚠️ ระบุรูปแบบไม่ได้ ({unparsedInsights.length} รายการ) — คลิกเพื่อดู
              </span>
              <span className="text-yellow-500 text-xs">{showUnparsed ? "▲ ซ่อน" : "▼ แสดง"}</span>
            </button>
            {showUnparsed && (
              <div className="overflow-x-auto border-t border-yellow-700/30">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-yellow-700/20">
                      <th className="text-left py-2 px-3 text-yellow-500 font-medium">Ad Account</th>
                      <th className="text-left py-2 px-3 text-yellow-500 font-medium">Ad Name</th>
                      <th className="text-right py-2 px-3 text-yellow-500 font-medium">Spend</th>
                      <th className="text-right py-2 px-3 text-yellow-500 font-medium">Inbox</th>
                    </tr>
                  </thead>
                  <tbody>
                    {unparsedInsights
                      .sort((a, b) => b.spend - a.spend)
                      .slice(0, 50)
                      .map((ins, i) => (
                        <tr key={i} className="border-b border-yellow-700/10 hover:bg-yellow-900/20">
                          <td className="py-1.5 px-3 text-yellow-300/70">{ins.accountId} — {ins.accountName}</td>
                          <td className="py-1.5 px-3 text-white font-mono">{ins.adName}</td>
                          <td className="py-1.5 px-3 text-right text-yellow-300">{fmtB(ins.spend)}</td>
                          <td className="py-1.5 px-3 text-right text-yellow-300">{fmt(ins.inbox)}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Unknown branch code warning */}
        {unknownBranches.length > 0 && (
          <div className="bg-orange-900/20 border border-orange-700/50 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <AlertTriangle className="w-4 h-4 text-orange-400 flex-shrink-0" />
              <span className="text-orange-400 text-sm font-medium">Branch code ไม่รู้จัก ({unknownBranches.length} รหัส) — ยังไม่มีใน BRANCH_MAP</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {unknownBranches.map(([bc, { spend, example }]) => (
                <div key={bc} className="bg-orange-900/30 border border-orange-700/40 rounded-lg px-3 py-1.5 text-xs">
                  <span className="font-mono text-orange-300 font-bold">{bc}</span>
                  <span className="text-orange-400/70 ml-2">{fmtB(spend)}</span>
                  <span className="text-orange-400/50 ml-2 truncate max-w-[120px] inline-block align-bottom" title={example}>{example}</span>
                </div>
              ))}
            </div>
            <Link
              href="/settings"
              className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 bg-orange-600/20 hover:bg-orange-600/30 border border-orange-600/40 rounded-lg text-xs text-orange-300 font-medium transition-colors"
            >
              <Settings2 className="w-3.5 h-3.5" />
              เพิ่มสาขาในหน้าตั้งค่า
            </Link>
          </div>
        )}

        <KpiCards
          insights={filteredInsights}
          prevInsights={filteredPrevInsights}
          showComparison={showComparison}
          filterSummary={
            [
              adCodeFilter ? `Code: "${adCodeFilter}"` : "",
              branchFilter === "class" ? "Class" : branchFilter === "classgo" ? "Class Go" : "ทุกกลุ่ม",
              programFilter !== "all" ? PROGRAM_MAP[programFilter] || programFilter : "ทุกโปรแกรม",
              branchNameFilter !== "all" ? branchNameFilter : "ทุกสาขา",
            ].filter(Boolean).join(" / ")
          }
        />

        {(topBranch || topProgram || bestCPI || bestCPL) && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
            {topBranch && (
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex items-start gap-3">
                <div className="w-10 h-10 rounded-full bg-emerald-500/15 flex items-center justify-center">
                  <MapPin className="w-5 h-5 text-emerald-400" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs text-slate-400">Top Branch (Spend)</p>
                  <p className="text-sm font-semibold text-white truncate">{topBranch.name}</p>
                  <p className="text-sm font-bold text-emerald-400">{fmtB(topBranch.spend)}</p>
                </div>
              </div>
            )}
            {topProgram && (
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex items-start gap-3">
                <div className="w-10 h-10 rounded-full bg-indigo-500/15 flex items-center justify-center">
                  <Layers className="w-5 h-5 text-indigo-400" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs text-slate-400">Top Program (Spend)</p>
                  <p className="text-sm font-semibold text-white truncate">{topProgram.name}</p>
                  <p className="text-sm font-bold text-indigo-300">{fmtB(topProgram.spend)}</p>
                </div>
              </div>
            )}
            {bestCPI && (
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex items-start gap-3">
                <div className="w-10 h-10 rounded-full bg-amber-500/15 flex items-center justify-center">
                  <Gauge className="w-5 h-5 text-amber-400" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs text-slate-400">Best CPI</p>
                  <p className="text-sm font-semibold text-white truncate">{bestCPI.name}</p>
                  <p className="text-sm font-bold text-amber-300">{fmtB(bestCPI.value)}</p>
                </div>
              </div>
            )}
            {bestCPL && (
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex items-start gap-3">
                <div className="w-10 h-10 rounded-full bg-pink-500/15 flex items-center justify-center">
                  <Target className="w-5 h-5 text-pink-400" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs text-slate-400">Best CPL</p>
                  <p className="text-sm font-semibold text-white truncate">{bestCPL.name}</p>
                  <p className="text-sm font-bold text-pink-300">{fmtB(bestCPL.value)}</p>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Tabs */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
          <div className="flex flex-wrap items-center gap-2 mb-6 border-b border-gray-800 pb-4">
            {tabs.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  tab === t.key
                    ? "bg-indigo-600 text-white"
                    : "text-gray-400 hover:text-white hover:bg-gray-800"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className="pb-4">
            <FilterBar
              tab={tab}
              branchFilter={branchFilter}
              onBranchFilter={setBranchFilter}
              branchName={branchNameFilter}
              onBranchName={setBranchNameFilter}
              branchOptions={branchOptions}
              programFilter={programFilter}
              onProgramFilter={setProgramFilter}
              programOptions={programOptions}
              adCodeFilter={adCodeFilter}
              onAdCodeFilter={setAdCodeFilter}
              showComparison={showComparison}
              onToggleComparison={setShowComparison}
              onClear={handleClearFilters}
              excludedBranches={excludedBranches}
              onExcludedBranches={setExcludedBranches}
              allBranchNames={branchOptionsAll}
            />
            {testBranchNames.size > 0 && (
              <button
                onClick={() => setShowTestBranches((value) => !value)}
                className="mt-2 px-3 py-1.5 rounded-lg text-xs text-amber-300 border border-amber-700/50 bg-amber-900/20 hover:bg-amber-900/40 transition-colors"
              >
                {showTestBranches ? "ซ่อนสาขาเทส" : "แสดงสาขาเทส"}
              </button>
            )}
          </div>

          {loading ? (
            <div className="flex items-center justify-center h-64 text-gray-400">
              <RefreshCw className="w-6 h-6 animate-spin mr-2" />
              กำลังดึงข้อมูลจาก Meta API...
            </div>
          ) : tab === "creative" ? (
            <CreativeGrid insights={filteredInsights} />
          ) : chartData.length === 0 ? (
            <div className="flex items-center justify-center h-64 text-gray-500">
              ไม่มีข้อมูล
            </div>
          ) : (
            <div className="space-y-6">
              {/* Bar Chart */}
              <ResponsiveContainer width="100%" height={320}>
                <BarChart data={chartData} margin={{ top: 0, right: 0, left: 0, bottom: 60 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                  <XAxis
                    dataKey="name"
                    tick={{ fill: "#9ca3af", fontSize: 11 }}
                    angle={-35}
                    textAnchor="end"
                    interval={0}
                  />
                  <YAxis
                    tick={{ fill: "#9ca3af", fontSize: 11 }}
                    tickFormatter={(v) => fmtB(v)}
                  />
                  <Tooltip
                    contentStyle={{ backgroundColor: "#111827", border: "1px solid #374151", borderRadius: 8 }}
                    labelStyle={{ color: "#f9fafb", fontWeight: "bold" }}
                    formatter={(value, name) => {
                      const v = Number(value) || 0;
                      if (name === "spend") return [fmtB(v), "ยอดใช้จ่าย"];
                      return [fmt(v), String(name)];
                    }}
                  />
                  <Bar dataKey="spend" radius={[4, 4, 0, 0]}>
                    {chartData.map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>

              {/* Table */}
              <SortableMetricTable
                rows={chartData}
                tab={tab}
                sort={tableSort}
                onSort={handleTableSort}
                showComparison={showComparison}
                onProgramDrill={(name) => {
                  const code = Object.entries(PROGRAM_MAP).find(([, v]) => v === name)?.[0] || "all";
                  setProgramFilter(code);
                  setTab("creative");
                }}
              />
            </div>
          )}
        </div>
      </div>

      {/* Mobile floating filter summary */}
      <div className="fixed bottom-4 right-4 sm:hidden z-20">
        <div className="px-3 py-2 rounded-lg bg-slate-900/90 border border-slate-700 text-[11px] text-slate-200 shadow-lg shadow-black/30">
          {[
            adCodeFilter ? `Code: "${adCodeFilter}"` : "",
            branchFilter === "class" ? "Class" : branchFilter === "classgo" ? "Class Go" : "ทุกกลุ่ม",
            programFilter !== "all" ? PROGRAM_MAP[programFilter] || programFilter : "ทุกโปรแกรม",
            branchNameFilter !== "all" ? branchNameFilter : "ทุกสาขา",
          ].filter(Boolean).join(" / ")}
        </div>
      </div>
    </div>
  );
}
