"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  RefreshCw,
  Search,
  ArrowUpDown,
  ChevronUp,
  ChevronDown,
  Filter,
  X,
  DollarSign,
  MessageSquare,
  TrendingDown,
  Wallet,
  LayoutList,
  Tag,
  Plus,
  Check,
} from "lucide-react";
import DateRangePicker from "@/components/DateRangePicker";
import LogoutButton from "@/components/LogoutButton";
import type { CampaignRow } from "@/lib/meta";

type FetchFailure = {
  scope: string;
  accountId?: string;
  accountName?: string;
  message: string;
  tokenIndex?: number;
};

/* ── helpers ─────────────────────────────────── */

function fmt(n: number) {
  return n.toLocaleString("th-TH", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}
function fmtB(n: number) {
  if (n >= 1_000_000) return `฿${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `฿${(n / 1_000).toFixed(1)}K`;
  return `฿${n.toFixed(0)}`;
}

const DATE_PRESETS = [
  { label: "วันนี้", value: "today" },
  { label: "เมื่อวาน", value: "yesterday" },
  { label: "7 วัน", value: "last_7d" },
  { label: "30 วัน", value: "last_30d" },
  { label: "เดือนนี้", value: "this_month" },
  { label: "เดือนที่แล้ว", value: "last_month" },
];

type SortCol = "accountId" | "campaignName" | "spent" | "budget" | "inbox" | "cpi" | "tag";
type SortDir = "asc" | "desc";

interface MetricFilter {
  min: string;
  max: string;
}

const EMPTY_METRIC: MetricFilter = { min: "", max: "" };

/* ── tag system ──────────────────────────────── */

const TAGS_STORAGE_KEY = "korrakot_campaign_tags";

const PRESET_TAGS = [
  "✅ Active",
  "⏸️ Paused",
  "🔥 Hot",
  "⚠️ Review",
  "💀 Dead",
  "🧪 Test",
  "⭐ Top",
  "📌 Pinned",
];

const TAG_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  "✅ Active":  { bg: "bg-emerald-500/15", border: "border-emerald-500/40", text: "text-emerald-300" },
  "⏸️ Paused":  { bg: "bg-slate-500/15",   border: "border-slate-500/40",   text: "text-slate-300" },
  "🔥 Hot":     { bg: "bg-orange-500/15",  border: "border-orange-500/40",  text: "text-orange-300" },
  "⚠️ Review":  { bg: "bg-yellow-500/15",  border: "border-yellow-500/40",  text: "text-yellow-300" },
  "💀 Dead":    { bg: "bg-red-500/15",     border: "border-red-500/40",     text: "text-red-300" },
  "🧪 Test":    { bg: "bg-cyan-500/15",    border: "border-cyan-500/40",    text: "text-cyan-300" },
  "⭐ Top":     { bg: "bg-amber-500/15",   border: "border-amber-500/40",   text: "text-amber-300" },
  "📌 Pinned":  { bg: "bg-indigo-500/15",  border: "border-indigo-500/40",  text: "text-indigo-300" },
};

const DEFAULT_TAG_COLOR = { bg: "bg-violet-500/15", border: "border-violet-500/40", text: "text-violet-300" };

function getTagColor(tag: string) {
  return TAG_COLORS[tag] || DEFAULT_TAG_COLOR;
}

function loadTags(): Record<string, string> {
  try {
    const raw = localStorage.getItem(TAGS_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveTags(tags: Record<string, string>) {
  try {
    localStorage.setItem(TAGS_STORAGE_KEY, JSON.stringify(tags));
  } catch {}
}

/* ── component ───────────────────────────────── */

export default function AdsPage() {
  // Data
  const [campaigns, setCampaigns] = useState<CampaignRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [fetchFailures, setFetchFailures] = useState<FetchFailure[]>([]);
  const [serverCacheHit, setServerCacheHit] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  // Date
  const [datePreset, setDatePreset] = useState("today");
  const [customSince, setCustomSince] = useState("");
  const [customUntil, setCustomUntil] = useState("");

  // Sort
  const [sortCol, setSortCol] = useState<SortCol>("spent");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  // Filters
  const [search, setSearch] = useState("");
  const [accountFilter, setAccountFilter] = useState("all");
  const [showMetricFilters, setShowMetricFilters] = useState(false);
  const [spentFilter, setSpentFilter] = useState<MetricFilter>(EMPTY_METRIC);
  const [budgetFilter, setBudgetFilter] = useState<MetricFilter>(EMPTY_METRIC);
  const [inboxFilter, setInboxFilter] = useState<MetricFilter>(EMPTY_METRIC);
  const [cpiFilter, setCpiFilter] = useState<MetricFilter>(EMPTY_METRIC);
  const [tagFilter, setTagFilter] = useState("all"); // "all" | "untagged" | specific tag

  // Tags
  const [tags, setTags] = useState<Record<string, string>>({});
  const [editingTagId, setEditingTagId] = useState<string | null>(null);
  const [customTagInput, setCustomTagInput] = useState("");

  // Load tags from localStorage on mount
  useEffect(() => {
    setTags(loadTags());
  }, []);

  const setTag = (campaignId: string, tag: string) => {
    const updated = { ...tags };
    if (tag) {
      updated[campaignId] = tag;
    } else {
      delete updated[campaignId];
    }
    setTags(updated);
    saveTags(updated);
    setEditingTagId(null);
    setCustomTagInput("");
  };

  const removeTag = (campaignId: string) => {
    const updated = { ...tags };
    delete updated[campaignId];
    setTags(updated);
    saveTags(updated);
  };

  /* ── fetch ──────────────────────────────────── */

  const load = useCallback(
    async (force = false, overrideDates?: { since: string; until: string }) => {
      const effectiveSince = overrideDates?.since ?? customSince;
      const effectiveUntil = overrideDates?.until ?? customUntil;

      if (datePreset === "custom" && (!effectiveSince || !effectiveUntil)) return;

      const cacheKey =
        datePreset === "custom"
          ? `campaigns_custom_${effectiveSince}_${effectiveUntil}`
          : `campaigns_${datePreset}`;

      if (!force) {
        try {
          const cached = sessionStorage.getItem(cacheKey);
          if (cached) {
            const { data, failures, fetchedAt, ts } = JSON.parse(cached);
            if (Date.now() - ts < 15 * 60 * 1000) {
              setCampaigns(data || []);
              setFetchFailures(failures || []);
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
        if (datePreset === "custom") {
          url = `/api/campaigns?since=${effectiveSince}&until=${effectiveUntil}`;
        } else {
          url = `/api/campaigns?date_preset=${datePreset}`;
        }
        if (force) url += `${url.includes("?") ? "&" : "?"}refresh=1`;
        const res = await fetch(url);
        const data = await res.json();
        if (data.error) throw new Error(data.error);

        const rows: CampaignRow[] = data.campaigns || [];
        const failures: FetchFailure[] = data.failures || [];
        const fetchedAt = data.cache?.fetchedAt || new Date().toISOString();
        setCampaigns(rows);
        setFetchFailures(failures);
        setServerCacheHit(Boolean(data.cache?.hit));
        setLastUpdated(new Date(fetchedAt));
        try {
          sessionStorage.setItem(cacheKey, JSON.stringify({ data: rows, failures, fetchedAt, ts: Date.now() }));
        } catch {}
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : "เกิดข้อผิดพลาด");
      } finally {
        setLoading(false);
      }
    },
    [datePreset, customSince, customUntil]
  );

  useEffect(() => {
    if (datePreset === "custom") return;
    load();
  }, [load, datePreset]);

  /* ── account options ────────────────────────── */

  const accountOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of campaigns) {
      if (!map.has(c.accountId)) map.set(c.accountId, c.accountName);
    }
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [campaigns]);

  /* ── filter + sort ──────────────────────────── */

  const matchRange = (value: number, filter: MetricFilter) => {
    if (filter.min !== "" && value < parseFloat(filter.min)) return false;
    if (filter.max !== "" && value > parseFloat(filter.max)) return false;
    return true;
  };

  // Unique tags used across all campaigns (for the tag filter dropdown)
  const allUsedTags = useMemo(() => {
    return [...new Set(Object.values(tags))].sort();
  }, [tags]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return campaigns.filter((c) => {
      // text search
      if (
        q &&
        !c.campaignName.toLowerCase().includes(q) &&
        !c.accountId.toLowerCase().includes(q) &&
        !c.accountName.toLowerCase().includes(q)
      )
        return false;
      // account filter
      if (accountFilter !== "all" && c.accountId !== accountFilter) return false;
      // tag filter
      if (tagFilter === "untagged" && tags[c.campaignId]) return false;
      if (tagFilter !== "all" && tagFilter !== "untagged" && tags[c.campaignId] !== tagFilter) return false;
      // metric filters
      if (!matchRange(c.spent, spentFilter)) return false;
      if (!matchRange(c.budget, budgetFilter)) return false;
      if (!matchRange(c.inbox, inboxFilter)) return false;
      if (c.inbox > 0 && !matchRange(c.cpi, cpiFilter)) return false;
      if (c.inbox === 0 && cpiFilter.max !== "") return false; // no inbox → CPI infinite → exclude if max is set
      return true;
    });
  }, [campaigns, search, accountFilter, tagFilter, tags, spentFilter, budgetFilter, inboxFilter, cpiFilter]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      let av: number | string;
      let bv: number | string;

      switch (sortCol) {
        case "accountId":
          av = a.accountName || a.accountId;
          bv = b.accountName || b.accountId;
          break;
        case "campaignName":
          av = a.campaignName;
          bv = b.campaignName;
          break;
        case "spent":
          av = a.spent;
          bv = b.spent;
          break;
        case "budget":
          av = a.budget;
          bv = b.budget;
          break;
        case "inbox":
          av = a.inbox;
          bv = b.inbox;
          break;
        case "cpi":
          av = a.inbox > 0 ? a.cpi : Infinity;
          bv = b.inbox > 0 ? b.cpi : Infinity;
          break;
        case "tag":
          av = tags[a.campaignId] || "";
          bv = tags[b.campaignId] || "";
          break;
        default:
          av = 0;
          bv = 0;
      }

      if (typeof av === "string") {
        return sortDir === "asc" ? av.localeCompare(bv as string) : (bv as string).localeCompare(av);
      }
      return sortDir === "asc" ? (av as number) - (bv as number) : (bv as number) - (av as number);
    });
  }, [filtered, sortCol, sortDir, tags]);

  /* ── aggregated KPIs ────────────────────────── */

  const totalSpent = filtered.reduce((s, c) => s + c.spent, 0);
  const totalBudget = filtered.reduce((s, c) => s + c.budget, 0);
  const totalInbox = filtered.reduce((s, c) => s + c.inbox, 0);
  const avgCPI = totalInbox > 0 ? totalSpent / totalInbox : 0;

  /* ── sort handler ───────────────────────────── */

  const handleSort = (col: SortCol) => {
    if (sortCol === col) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortCol(col);
      setSortDir(col === "cpi" ? "asc" : "desc");
    }
  };

  const SortIcon = ({ col }: { col: SortCol }) => {
    if (sortCol !== col) return <ArrowUpDown className="w-3 h-3 text-gray-500 ml-1" />;
    return sortDir === "asc" ? (
      <ChevronUp className="w-3.5 h-3.5 text-indigo-400 ml-1" />
    ) : (
      <ChevronDown className="w-3.5 h-3.5 text-indigo-400 ml-1" />
    );
  };

  /* ── clear metric filters ───────────────────── */

  const hasMetricFilters =
    spentFilter.min !== "" ||
    spentFilter.max !== "" ||
    budgetFilter.min !== "" ||
    budgetFilter.max !== "" ||
    inboxFilter.min !== "" ||
    inboxFilter.max !== "" ||
    cpiFilter.min !== "" ||
    cpiFilter.max !== "";

  const clearMetricFilters = () => {
    setSpentFilter(EMPTY_METRIC);
    setBudgetFilter(EMPTY_METRIC);
    setInboxFilter(EMPTY_METRIC);
    setCpiFilter(EMPTY_METRIC);
  };

  /* ── render ─────────────────────────────────── */

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* Header */}
      <div className="border-b border-gray-800 bg-gray-900 px-4 sm:px-6 py-3 sm:py-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="flex items-center gap-2">
              <LayoutList className="w-5 h-5 text-indigo-400" />
              <h1 className="text-xl font-bold text-white">Ads Campaign</h1>
            </div>
            {lastUpdated && (
              <p className="text-xs text-gray-400 mt-0.5">
                อัปเดตข้อมูล: {lastUpdated.toLocaleTimeString("th-TH", { timeZone: "Asia/Bangkok" })}
                {serverCacheHit && <span className="text-slate-500"> (จาก cache)</span>}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2 sm:gap-3 flex-wrap justify-end">
            {/* Date presets */}
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
                load(true, { since: s, until: u });
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
            <LogoutButton />
          </div>
        </div>
      </div>

      <div className="p-4 sm:p-6 space-y-5">
        {error && (
          <div className="bg-red-900/40 border border-red-700 rounded-lg px-4 py-3 text-red-300 text-sm">
            ❌ {error}
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

        {/* KPI Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 md:gap-4">
          {[
            {
              label: "Total Spent",
              value: fmtB(totalSpent),
              icon: DollarSign,
              color: "text-emerald-400",
              tint: "bg-emerald-500/15",
            },
            {
              label: "Total Budget",
              value: fmtB(totalBudget),
              icon: Wallet,
              color: "text-sky-400",
              tint: "bg-sky-500/15",
            },
            {
              label: "Total Inbox",
              value: fmt(totalInbox),
              icon: MessageSquare,
              color: "text-purple-400",
              tint: "bg-purple-500/15",
            },
            {
              label: "Avg CPI",
              value: totalInbox > 0 ? fmtB(avgCPI) : "-",
              icon: TrendingDown,
              color: "text-amber-400",
              tint: "bg-amber-500/15",
            },
          ].map((card) => (
            <div
              key={card.label}
              className="bg-gradient-to-br from-slate-900 to-slate-850 border border-slate-800/80 rounded-xl p-3 md:p-4 shadow-lg shadow-black/20 flex flex-col gap-2"
            >
              <div className="flex items-center gap-2">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center ${card.tint}`}>
                  <card.icon className={`w-4 h-4 ${card.color}`} />
                </div>
                <span className="text-xs text-slate-300">{card.label}</span>
              </div>
              <div className="text-xl md:text-2xl font-bold text-white">{card.value}</div>
            </div>
          ))}
        </div>

        {/* Filters section */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 sm:p-6">
          {/* Search + Account + Metric toggle */}
          <div className="flex flex-wrap items-center gap-3 mb-4">
            {/* Text search */}
            <div className="relative flex-1 min-w-[200px] max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
              <input
                id="ads-search"
                type="text"
                placeholder="ค้นหา Campaign Name / Account ID..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-10 pr-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 transition-colors"
              />
              {search && (
                <button
                  onClick={() => setSearch("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            {/* Account dropdown */}
            <select
              id="ads-account-filter"
              value={accountFilter}
              onChange={(e) => setAccountFilter(e.target.value)}
              className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 transition-colors"
            >
              <option value="all">ทุก Account</option>
              {accountOptions.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>

            {/* Tag filter dropdown */}
            <select
              id="ads-tag-filter"
              value={tagFilter}
              onChange={(e) => setTagFilter(e.target.value)}
              className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 transition-colors"
            >
              <option value="all">ทุก Tag</option>
              <option value="untagged">ยังไม่มี Tag</option>
              {allUsedTags.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>

            {/* Metric filter toggle */}
            <button
              onClick={() => setShowMetricFilters((v) => !v)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors border ${
                showMetricFilters || hasMetricFilters
                  ? "bg-indigo-600/20 border-indigo-500/50 text-indigo-300"
                  : "bg-gray-800 border-gray-700 text-gray-400 hover:text-white"
              }`}
            >
              <Filter className="w-4 h-4" />
              Filter Metrics
              {hasMetricFilters && (
                <span className="w-2 h-2 rounded-full bg-indigo-400 animate-pulse" />
              )}
            </button>

            {hasMetricFilters && (
              <button
                onClick={clearMetricFilters}
                className="flex items-center gap-1 px-2 py-1.5 rounded-md text-xs text-red-400 hover:text-red-300 hover:bg-red-900/20 transition-colors"
              >
                <X className="w-3 h-3" />
                ล้าง Filter
              </button>
            )}

            {/* Result count */}
            <div className="ml-auto text-xs text-gray-500">
              {filtered.length}/{campaigns.length} campaigns
            </div>
          </div>

          {/* Metric filter panel */}
          {showMetricFilters && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5 p-4 bg-gray-800/50 border border-gray-700/50 rounded-lg">
              {(
                [
                  { label: "Spent (฿)", state: spentFilter, setter: setSpentFilter },
                  { label: "Budget (฿)", state: budgetFilter, setter: setBudgetFilter },
                  { label: "Inbox", state: inboxFilter, setter: setInboxFilter },
                  { label: "CPI (฿)", state: cpiFilter, setter: setCpiFilter },
                ] as const
              ).map(({ label, state, setter }) => (
                <div key={label} className="space-y-1.5">
                  <label className="text-xs text-gray-400 font-medium">{label}</label>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="number"
                      placeholder="Min"
                      value={state.min}
                      onChange={(e) => setter({ ...state, min: e.target.value })}
                      className="w-full px-2.5 py-1.5 bg-gray-900 border border-gray-700 rounded-md text-xs text-white placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-indigo-500/50"
                    />
                    <span className="text-gray-600 text-xs">–</span>
                    <input
                      type="number"
                      placeholder="Max"
                      value={state.max}
                      onChange={(e) => setter({ ...state, max: e.target.value })}
                      className="w-full px-2.5 py-1.5 bg-gray-900 border border-gray-700 rounded-md text-xs text-white placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-indigo-500/50"
                    />
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Table */}
          {loading ? (
            <div className="flex items-center justify-center h-64 text-gray-400">
              <RefreshCw className="w-6 h-6 animate-spin mr-2" />
              กำลังดึงข้อมูลจาก Meta API...
            </div>
          ) : sorted.length === 0 ? (
            <div className="flex items-center justify-center h-64 text-gray-500">
              ไม่มีข้อมูล
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs sm:text-sm" id="ads-table">
                <thead className="sticky top-0 bg-gray-900 z-20">
                  <tr className="border-b border-gray-800">
                    <th className="text-left py-2.5 px-3 text-gray-500 font-medium w-8 sticky left-0 z-20 bg-gray-900">#</th>
                    <th
                      onClick={() => handleSort("accountId")}
                      className="py-2.5 px-3 text-gray-400 font-medium cursor-pointer select-none hover:text-white transition-colors text-left sticky left-[32px] z-20 bg-gray-900 min-w-[140px]"
                    >
                      <span className="inline-flex items-center gap-0.5">Account <SortIcon col="accountId" /></span>
                    </th>
                    <th
                      onClick={() => handleSort("campaignName")}
                      className="py-2.5 px-3 text-gray-400 font-medium cursor-pointer select-none hover:text-white transition-colors text-left sticky left-[172px] z-20 bg-gray-900 min-w-[250px] after:content-[''] after:absolute after:right-0 after:top-0 after:bottom-0 after:w-[3px] after:bg-gradient-to-r after:from-gray-700/50 after:to-transparent"
                    >
                      <span className="inline-flex items-center gap-0.5">Campaign Name <SortIcon col="campaignName" /></span>
                    </th>
                    {(
                      [
                        { col: "tag" as SortCol, label: "Tag", align: "left" },
                        { col: "spent" as SortCol, label: "Spent", align: "right" },
                        { col: "budget" as SortCol, label: "Budget", align: "right" },
                        { col: "inbox" as SortCol, label: "Inbox", align: "right" },
                        { col: "cpi" as SortCol, label: "CPI", align: "right" },
                      ] as const
                    ).map(({ col, label, align }) => (
                      <th
                        key={col}
                        onClick={() => handleSort(col)}
                        className={`py-2.5 px-3 text-gray-400 font-medium cursor-pointer select-none hover:text-white transition-colors ${
                          align === "left" ? "text-left" : "text-right"
                        }`}
                      >
                        <span
                          className={`inline-flex items-center gap-0.5 ${align === "right" ? "justify-end w-full" : ""}`}
                        >
                          {label}
                          <SortIcon col={col} />
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((row, i) => (
                    <tr
                      key={`${row.campaignId}-${row.accountId}`}
                      className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors group"
                    >
                      <td className="py-2.5 px-3 text-gray-500 text-[11px] sticky left-0 z-10 bg-gray-900 group-hover:bg-gray-800">{i + 1}</td>
                      <td className="py-2.5 px-3 sticky left-[32px] z-10 bg-gray-900 group-hover:bg-gray-800 min-w-[140px]">
                        <div className="flex flex-col">
                          <span className="text-white text-xs font-medium">{row.accountName}</span>
                          <span className="text-gray-500 text-[10px] font-mono">{row.accountId}</span>
                        </div>
                      </td>
                      <td className="py-2.5 px-3 text-white max-w-[300px] sticky left-[172px] z-10 bg-gray-900 group-hover:bg-gray-800 min-w-[250px] relative after:content-[''] after:absolute after:right-0 after:top-0 after:bottom-0 after:w-[3px] after:bg-gradient-to-r after:from-gray-700/50 after:to-transparent">
                        <span className="truncate block" title={row.campaignName}>
                          {row.campaignName}
                        </span>
                      </td>
                      {/* Tag cell */}
                      <td className="py-2.5 px-3 relative">
                        {editingTagId === row.campaignId ? (
                          // Tag editor popover
                          <div className="absolute left-0 top-0 z-30 bg-gray-800 border border-gray-600 rounded-lg shadow-xl shadow-black/40 p-2 min-w-[200px]">
                            <div className="flex flex-wrap gap-1.5 mb-2">
                              {PRESET_TAGS.map((pt) => {
                                const tc = getTagColor(pt);
                                return (
                                  <button
                                    key={pt}
                                    onClick={() => setTag(row.campaignId, pt)}
                                    className={`px-2 py-1 rounded-md text-[11px] font-medium border transition-all hover:scale-105 ${tc.bg} ${tc.border} ${tc.text}`}
                                  >
                                    {pt}
                                  </button>
                                );
                              })}
                            </div>
                            <div className="flex gap-1.5">
                              <input
                                type="text"
                                placeholder="Custom tag..."
                                value={customTagInput}
                                onChange={(e) => setCustomTagInput(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter" && customTagInput.trim()) {
                                    setTag(row.campaignId, customTagInput.trim());
                                  }
                                  if (e.key === "Escape") {
                                    setEditingTagId(null);
                                    setCustomTagInput("");
                                  }
                                }}
                                autoFocus
                                className="flex-1 px-2 py-1 bg-gray-900 border border-gray-700 rounded-md text-xs text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-indigo-500/50"
                              />
                              {customTagInput.trim() && (
                                <button
                                  onClick={() => setTag(row.campaignId, customTagInput.trim())}
                                  className="px-2 py-1 bg-indigo-600 hover:bg-indigo-500 rounded-md text-xs text-white transition-colors"
                                >
                                  <Check className="w-3 h-3" />
                                </button>
                              )}
                            </div>
                            <div className="flex items-center justify-between mt-2 pt-2 border-t border-gray-700">
                              {tags[row.campaignId] && (
                                <button
                                  onClick={() => removeTag(row.campaignId)}
                                  className="text-[10px] text-red-400 hover:text-red-300 transition-colors"
                                >
                                  ลบ Tag
                                </button>
                              )}
                              <button
                                onClick={() => { setEditingTagId(null); setCustomTagInput(""); }}
                                className="text-[10px] text-gray-400 hover:text-white ml-auto transition-colors"
                              >
                                ปิด
                              </button>
                            </div>
                          </div>
                        ) : tags[row.campaignId] ? (
                          // Show tag chip
                          <button
                            onClick={() => setEditingTagId(row.campaignId)}
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium border transition-all hover:scale-105 cursor-pointer ${
                              getTagColor(tags[row.campaignId]).bg
                            } ${getTagColor(tags[row.campaignId]).border} ${getTagColor(tags[row.campaignId]).text}`}
                          >
                            <Tag className="w-3 h-3" />
                            {tags[row.campaignId]}
                          </button>
                        ) : (
                          // No tag — show add button
                          <button
                            onClick={() => setEditingTagId(row.campaignId)}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] text-gray-600 hover:text-gray-300 border border-transparent hover:border-gray-700 transition-all"
                          >
                            <Plus className="w-3 h-3" />
                            Tag
                          </button>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-right font-medium text-emerald-400">
                        {fmtB(row.spent)}
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <div className="flex flex-col items-end">
                          <span className="text-sky-300">{row.budget > 0 ? fmtB(row.budget) : "-"}</span>
                          {row.budgetType !== "-" && (
                            <span className="text-[10px] text-gray-500">{row.budgetType}</span>
                          )}
                        </div>
                      </td>
                      <td className="py-2.5 px-3 text-right text-purple-300">{fmt(row.inbox)}</td>
                      <td className="py-2.5 px-3 text-right">
                        {row.inbox > 0 ? (
                          <span
                            className={`font-medium ${
                              row.cpi <= 50
                                ? "text-emerald-400"
                                : row.cpi <= 100
                                  ? "text-amber-400"
                                  : "text-rose-400"
                            }`}
                          >
                            ฿{row.cpi.toFixed(0)}
                          </span>
                        ) : (
                          <span className="text-gray-600">-</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
