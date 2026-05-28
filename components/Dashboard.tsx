"use client";

import { useState, useEffect, useCallback } from "react";
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
import { RefreshCw, AlertTriangle, MapPin, Layers, Gauge, Target } from "lucide-react";
import { BRANCH_MAP, PROGRAM_MAP } from "@/lib/parser";
import type { AdInsight } from "@/lib/meta";
import CreativeGrid from "@/components/CreativeGrid";
import KpiCards from "@/components/KpiCards";
import FilterBar from "@/components/FilterBar";
import SortableMetricTable from "@/components/SortableMetricTable";
import { COLORS } from "./theme";
import type { GroupedRow, TabKey } from "./types";

const DATE_PRESETS = [
  { label: "วันนี้", value: "today" },
  { label: "เมื่อวาน", value: "yesterday" },
  { label: "7 วัน", value: "last_7d" },
  { label: "30 วัน", value: "last_30d" },
  { label: "เดือนนี้", value: "this_month" },
  { label: "เดือนที่แล้ว", value: "last_month" },
];

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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [datePreset, setDatePreset] = useState("today");
  const [tab, setTab] = useState<TabKey>("branch");
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [showUnparsed, setShowUnparsed] = useState(false);
  const [branchFilter, setBranchFilter] = useState<"all" | "class" | "classgo">("all");
  const [branchNameFilter, setBranchNameFilter] = useState<string>("all");
  const [programFilter, setProgramFilter] = useState<string>("all");
  const [tableSort, setTableSort] = useState<{ col: string; dir: "asc" | "desc" }>({ col: "spend", dir: "desc" });

  // Load initial filters from URL Search Params on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const d = params.get("date");
    const t = params.get("tab") as TabKey;
    const bf = params.get("bf") as "all" | "class" | "classgo";
    const bnf = params.get("bnf");
    const pf = params.get("pf");

    if (d) setDatePreset(d);
    if (t && ["branch", "program", "creative"].includes(t)) setTab(t);
    if (bf && ["all", "class", "classgo"].includes(bf)) setBranchFilter(bf);
    if (bnf) setBranchNameFilter(bnf);
    if (pf) setProgramFilter(pf);
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

    const newSearch = params.toString();
    const currentSearch = window.location.search.replace(/^\?/, "");
    if (newSearch !== currentSearch) {
      const newUrl = `${window.location.pathname}${newSearch ? "?" + newSearch : ""}`;
      window.history.replaceState({ ...window.history.state, as: newUrl, url: newUrl }, "", newUrl);
    }
  }, [datePreset, tab, branchFilter, branchNameFilter, programFilter]);

  const handleTableSort = (col: string) => {
    setTableSort((prev) => prev.col === col ? { col, dir: prev.dir === "desc" ? "asc" : "desc" } : { col, dir: col === "cpi" || col === "cpl" ? "asc" : "desc" });
  };

  const handleClearFilters = () => {
    setBranchFilter("all");
    setBranchNameFilter("all");
    setProgramFilter("all");
  };

  const load = useCallback(async (force = false) => {
    const cacheKey = `insights_${datePreset}`;
    if (!force) {
      try {
        const cached = sessionStorage.getItem(cacheKey);
        if (cached) {
          const { data, ts } = JSON.parse(cached);
          if (Date.now() - ts < 15 * 60 * 1000) {
            setInsights(data);
            setLastUpdated(new Date(ts));
            return;
          }
        }
      } catch {}
    }
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/insights?date_preset=${datePreset}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setInsights(data.insights || []);
      setLastUpdated(new Date());
      try { sessionStorage.setItem(cacheKey, JSON.stringify({ data: data.insights || [], ts: Date.now() })); } catch {}
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "เกิดข้อผิดพลาด");
    } finally {
      setLoading(false);
    }
  }, [datePreset]);

  useEffect(() => {
    load();
  }, [load]);

  const unparsedInsights = insights.filter((i) => !i.parsed.isParsed);

  // Unknown branch codes — parsed OK but branchCode not in BRANCH_MAP
  const unknownBranches = (() => {
    const map: Record<string, { spend: number; example: string }> = {};
    for (const i of insights) {
      const bc = i.parsed.branchCode;
      if (bc && !BRANCH_MAP[bc] && !['IG', 'หน้าบ้าน'].includes(bc)) {
        if (!map[bc]) map[bc] = { spend: 0, example: i.adName };
        map[bc].spend += i.spend;
      }
    }
    return Object.entries(map).sort((a, b) => b[1].spend - a[1].spend);
  })();

  const filteredInsights = insights.filter((i) => {
    const b = i.parsed.branch || "";
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

  const branchOptionsAll = [...new Set(insights.map((i) => i.parsed.branch).filter(Boolean))].sort();
  const branchOptions = branchOptionsAll.filter((b) => {
    if (branchFilter === "classgo") return b.startsWith("Class Go");
    if (branchFilter === "class") return !b.startsWith("Class Go");
    return true;
  });

  const totalSpend = filteredInsights.reduce((s, i) => s + i.spend, 0);
  const totalImpressions = filteredInsights.reduce((s, i) => s + i.impressions, 0);
  const totalInbox = filteredInsights.reduce((s, i) => s + i.inbox, 0);
  const totalLeads = filteredInsights.reduce((s, i) => s + i.leads, 0);
  const avgCPI = totalInbox > 0 ? totalSpend / totalInbox : 0;
  const avgCPL = totalLeads > 0 ? totalSpend / totalLeads : 0;

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

  const bestCPI = (() => {
    const withInbox = filteredInsights.filter((i) => i.inbox > 0);
    if (!withInbox.length) return null;
    const sorted = [...withInbox].sort((a, b) => (a.spend / a.inbox) - (b.spend / b.inbox));
    const best = sorted[0];
    return { name: best.parsed.awCode || best.adName, value: best.spend / best.inbox };
  })();

  const bestCPL = (() => {
    const withLeads = filteredInsights.filter((i) => i.leads > 0);
    if (!withLeads.length) return null;
    const sorted = [...withLeads].sort((a, b) => (a.spend / a.leads) - (b.spend / b.leads));
    const best = sorted[0];
    return { name: best.parsed.awCode || best.adName, value: best.spend / best.leads };
  })();

  const rawChartData = groupBy(filteredInsights, tab);
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
  });

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
            <h1 className="text-xl font-bold text-white">Meta Ads Dashboard</h1>
            {lastUpdated && (
              <p className="text-xs text-gray-400 mt-0.5">
                อัปเดตล่าสุด: {lastUpdated.toLocaleTimeString("th-TH")}
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
                    datePreset === d.value
                      ? "bg-indigo-600 text-white"
                      : "text-gray-400 hover:text-white"
                  }`}
                >
                  {d.label}
                </button>
              ))}
            </div>
            <button
              onClick={() => load(true)}
              disabled={loading}
              className="flex items-center gap-2 px-3 sm:px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded-lg text-sm font-medium transition-colors"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
              {loading ? "กำลังโหลด..." : "รีเฟรช"}
            </button>
          </div>
        </div>
      </div>

      <div className="p-4 sm:p-6 space-y-6">
        {error && (
          <div className="bg-red-900/40 border border-red-700 rounded-lg px-4 py-3 text-red-300 text-sm">
            ❌ {error}
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
          </div>
        )}

        <KpiCards
          insights={filteredInsights}
          filterSummary={
            [
              branchFilter === "class" ? "Class" : branchFilter === "classgo" ? "Class Go" : "ทุกกลุ่ม",
              programFilter !== "all" ? PROGRAM_MAP[programFilter] || programFilter : "ทุกโปรแกรม",
              branchNameFilter !== "all" ? branchNameFilter : "ทุกสาขา",
            ].join(" / ")
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
              onClear={handleClearFilters}
            />
          </div>

          {loading ? (
            <div className="flex items-center justify-center h-64 text-gray-400">
              <RefreshCw className="w-6 h-6 animate-spin mr-2" />
              กำลังดึงข้อมูลจาก Meta API...
            </div>
          ) : tab === "creative" ? (
            <CreativeGrid insights={insights} branchFilter={branchFilter} branchName={branchNameFilter} programFilter={programFilter} />
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
            branchFilter === "class" ? "Class" : branchFilter === "classgo" ? "Class Go" : "ทุกกลุ่ม",
            programFilter !== "all" ? PROGRAM_MAP[programFilter] || programFilter : "ทุกโปรแกรม",
            branchNameFilter !== "all" ? branchNameFilter : "ทุกสาขา",
          ].join(" / ")}
        </div>
      </div>
    </div>
  );
}
