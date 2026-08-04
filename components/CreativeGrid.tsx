"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import type { AdInsight } from "@/lib/meta";
import { Play, Image as ImageIcon, X, ChevronDown, ChevronUp } from "lucide-react";
import { PROGRAM_MAP } from "@/lib/parser";
import { hasReliableCost, MIN_BEST_ACTIONS } from "@/lib/metrics";

interface ModalData {
  thumbnailUrl: string;
  isVideo: boolean;
  groupKey: string;
  program: string;
  sub: string;
  spend: number;
  inbox: number;
  cpi: number;
  leads: number;
  cpl: number;
  branchCount: number;
}

interface CreativeInfo {
  thumbnailUrl: string;
  objectType: string;
  videoId?: string;
  imageHash?: string;
}

interface CreativeRow {
  groupKey: string;     // unique key e.g. "PF00-0292"
  creativeId: string;   // numeric suffix e.g. "0292"
  repAdId: string;      // one ad_id to fetch thumbnail from
  awCodeBase: string;   // program+sub part e.g. "PF00"
  program: string;
  sub: string;
  spend: number;
  inbox: number;
  cpi: number;
  leads: number;
  cpl: number;
  branchCount: number;
  adCount: number;
}

function proxyUrl(url: string) {
  if (!url) return "";
  return `/api/img?url=${encodeURIComponent(url)}`;
}

function fmtB(n: number) {
  if (n >= 1_000_000) return `฿${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `฿${(n / 1_000).toFixed(1)}K`;
  return `฿${n.toFixed(0)}`;
}
function fmt(n: number) {
  return n.toLocaleString("th-TH", { maximumFractionDigits: 0 });
}

function hasReliableMetric(row: Pick<CreativeRow, "spend" | "inbox" | "leads">, metric: "cpi" | "cpl") {
  return hasReliableCost(row, metric === "cpi" ? "inbox" : "leads");
}

type SortKey = "spend" | "inbox" | "cpi" | "leads" | "cpl";

interface Props {
  insights: AdInsight[];
  branchFilter?: "all" | "class" | "classgo";
  branchName?: string;
  programFilter?: string;
}

export default function CreativeGrid({ insights, branchFilter = "all", branchName = "all", programFilter = "all" }: Props) {
  const [creatives, setCreatives] = useState<Record<string, CreativeInfo>>({});
  const [loading, setLoading] = useState(false);
  const fetchedRef = useRef<Set<string>>(new Set());
  const [modal, setModal] = useState<ModalData | null>(null);
  const [sortBy, setSortBy] = useState<SortKey>("spend");
  const [expandedPrograms, setExpandedPrograms] = useState<Set<string>>(new Set());
  const [flatView, setFlatView] = useState(false);

  // Apply branch filter on insights
  const filteredInsights = insights.filter((i) => {
    const b = i.parsed.branch || "";
    if (branchFilter === "classgo" && !b.startsWith("Class Go")) return false;
    if (branchFilter === "class" && b.startsWith("Class Go")) return false;
    if (branchName !== "all" && b !== branchName) return false;
    return true;
  });

  // Group by [assetCode+programCode+subCode]-[creativeId] e.g. "PF00-0001"
  const rowMap: Record<string, CreativeRow & { branches: Set<string> }> = {};
  for (const ins of filteredInsights) {
    const cid = ins.parsed.creativeId;
    if (!cid || !ins.adId) continue;
    const awBase = ins.parsed.awCode.replace(/-\d+$/, "");
    const groupKey = `${awBase}-${cid}`;
    if (!rowMap[groupKey]) {
      rowMap[groupKey] = {
        groupKey,
        creativeId: cid,
        repAdId: ins.adId,
        awCodeBase: awBase,
        program: ins.parsed.program || ins.parsed.programCode,
        sub: ins.parsed.sub || "",
        spend: 0, inbox: 0, cpi: 0, leads: 0, cpl: 0,
        branchCount: 0, adCount: 0,
        branches: new Set(),
      };
    }
    rowMap[groupKey].spend += ins.spend;
    rowMap[groupKey].inbox += ins.inbox;
    rowMap[groupKey].leads += ins.leads;
    rowMap[groupKey].adCount += 1;
    rowMap[groupKey].branches.add(ins.parsed.branch || ins.parsed.branchCode);
  }

  const sortFn = (a: CreativeRow, b: CreativeRow) => {
    if (sortBy === "cpi") {
      const aValue = hasReliableMetric(a, "cpi") ? a.cpi : Infinity;
      const bValue = hasReliableMetric(b, "cpi") ? b.cpi : Infinity;
      return aValue - bValue || b.inbox - a.inbox;
    }
    if (sortBy === "cpl") {
      const aValue = hasReliableMetric(a, "cpl") ? a.cpl : Infinity;
      const bValue = hasReliableMetric(b, "cpl") ? b.cpl : Infinity;
      return aValue - bValue || b.leads - a.leads;
    }
    if (sortBy === "inbox") return b.inbox - a.inbox;
    if (sortBy === "leads") return b.leads - a.leads;
    return b.spend - a.spend;
  };

  const allRows = Object.values(rowMap)
    .map((r) => ({
      ...r,
      branchCount: r.branches.size,
      cpi: r.inbox > 0 ? r.spend / r.inbox : 0,
      cpl: r.leads > 0 ? r.spend / r.leads : 0,
    }))
    .sort(sortFn);

  // Filter by program if set
  const rows = programFilter !== "all"
    ? allRows.filter((r) => {
        const code = Object.entries(PROGRAM_MAP).find(([, v]) => v === r.program)?.[0];
        return code === programFilter || r.program === programFilter;
      })
    : allRows;
  const visibleRows = rows.slice(0, 200);

  // Group rows by program for hero section
  const programGroups: Record<string, CreativeRow[]> = {};
  for (const row of visibleRows) {
    const p = row.program || "อื่นๆ";
    if (!programGroups[p]) programGroups[p] = [];
    programGroups[p].push(row);
  }
  const programList = Object.entries(programGroups).sort((a, b) => {
    const spendA = a[1].reduce((s, r) => s + r.spend, 0);
    const spendB = b[1].reduce((s, r) => s + r.spend, 0);
    return spendB - spendA;
  });


  const toggleProgram = (p: string) => {
    setExpandedPrograms((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p); else next.add(p);
      return next;
    });
  };

  // Build repAdId -> accountId map
  const adToAccount = useMemo(() => {
    const map: Record<string, string> = {};
    for (const ins of insights) {
      if (ins.adId) map[ins.adId] = ins.accountId;
    }
    return map;
  }, [insights]);

  useEffect(() => {
    // Reset cache when insights change (e.g. date range switch)
    fetchedRef.current = new Set();
    // Resetting the thumbnail cache is coupled to the incoming insights prop.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCreatives({});
  }, [insights.length]);

  const fetchThumbnails = useCallback((targetRows: CreativeRow[]) => {
    const newRows = targetRows.filter((r) => !fetchedRef.current.has(r.groupKey));
    if (!newRows.length) return;
    newRows.forEach((r) => fetchedRef.current.add(r.groupKey));
    const adIds = newRows.map((r) => r.repAdId);
    const accountIds = newRows.map((r) => (adToAccount[r.repAdId] || "").replace("act_", ""));
    setLoading(true);
    fetch(`/api/creative?ad_ids=${adIds.join(",")}&account_ids=${accountIds.join(",")}`)
      .then((r) => r.json())
      .then((data: Record<string, CreativeInfo>) => {
        const remapped: Record<string, CreativeInfo> = {};
        newRows.forEach((r) => { if (data[r.repAdId]) remapped[r.groupKey] = data[r.repAdId]; });
        setCreatives((prev) => ({ ...prev, ...remapped }));
      })
      .finally(() => setLoading(false));
  }, [adToAccount]);

  // Only fetch top-3 of each program (heroes) on initial load
  useEffect(() => {
    const heroRows = programList.flatMap(([, progRows]) => progRows.slice(0, 3));
    fetchThumbnails(heroRows);
  }, [insights]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch remaining rows when a program is expanded
  useEffect(() => {
    for (const prog of expandedPrograms) {
      const progRows = programGroups[prog];
      if (progRows) fetchThumbnails(progRows);
    }
  }, [expandedPrograms]); // eslint-disable-line react-hooks/exhaustive-deps

  // Flat view — fetch thumbnails for every visible creative, not just heroes
  useEffect(() => {
    if (flatView) fetchThumbnails(visibleRows);
  }, [flatView]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div>
      {/* Modal */}
      {modal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setModal(null)}
        >
          <div
            className="relative bg-gray-900 rounded-2xl overflow-hidden max-w-2xl w-full shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setModal(null)}
              className="absolute top-3 right-3 z-10 bg-black/60 hover:bg-black/80 rounded-full p-1.5 transition-colors"
            >
              <X className="w-5 h-5 text-white" />
            </button>
            <div className="relative aspect-square bg-black">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={proxyUrl(modal.thumbnailUrl)}
                alt={modal.groupKey}
                className="w-full h-full object-contain"
              />
              {modal.isVideo && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="bg-black/60 rounded-full p-4">
                    <Play className="w-10 h-10 text-white fill-white" />
                  </div>
                </div>
              )}
            </div>
            <div className="p-4">
              <div className="flex items-center justify-between mb-3">
                <p className="font-mono text-indigo-300 font-bold">{modal.groupKey}</p>
                <span className={`text-xs px-2 py-1 rounded font-medium ${modal.isVideo ? "bg-purple-600" : "bg-blue-600"} text-white`}>
                  {modal.isVideo ? "VIDEO" : "IMAGE"}
                </span>
              </div>
              <p className="text-white font-medium mb-3">
                {modal.program}{modal.sub && modal.sub !== "รวม" ? ` ${modal.sub}` : ""}
                {modal.branchCount > 1 && <span className="ml-2 text-xs text-gray-400">({modal.branchCount} สาขา)</span>}
              </p>
              <div className="grid grid-cols-4 gap-3">
                {[
                  { label: "Spend", value: fmtB(modal.spend), color: "text-emerald-400" },
                  { label: "Inbox", value: fmt(modal.inbox), color: "text-purple-400" },
                  { label: "CPI", value: modal.spend > 0 && modal.inbox >= MIN_BEST_ACTIONS ? fmtB(modal.cpi) : "ข้อมูลน้อย", color: "text-yellow-400" },
                  { label: "CPL", value: modal.spend > 0 && modal.leads >= MIN_BEST_ACTIONS ? fmtB(modal.cpl) : "ข้อมูลน้อย", color: "text-pink-400" },
                ].map((s) => (
                  <div key={s.label} className="bg-gray-800 rounded-lg p-2 text-center">
                    <p className="text-xs text-gray-500">{s.label}</p>
                    <p className={`text-sm font-bold ${s.color}`}>{s.value}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Sort controls */}
      <div className="flex items-center gap-2 mb-2 text-[11px] sm:text-xs overflow-x-auto pb-1">
        {loading && <span className="text-xs text-gray-400">กำลังโหลดรูป...</span>}
        <span className="text-xs text-gray-400">เรียงตาม:</span>
        {(["spend", "inbox", "leads", "cpi", "cpl"] as SortKey[]).map((k) => (
          <button
            key={k}
            onClick={() => setSortBy(k)}
            className={`px-2.5 py-1 rounded-lg font-medium transition-colors ${
              sortBy === k ? "bg-indigo-600 text-white" : "text-gray-400 hover:text-white hover:bg-gray-800"
            }`}
          >
            {k === "spend" ? "Spend" : k === "inbox" ? "Inbox" : k === "cpi" ? "CPI ต่ำสุด" : k === "cpl" ? "CPL ต่ำสุด" : "Leads"}
          </button>
        ))}
        <span className="text-[10px] text-gray-500 whitespace-nowrap">CPI/CPL ใช้เฉพาะรายการที่มีผลลัพธ์ ≥ {MIN_BEST_ACTIONS}</span>
      </div>

      {/* View mode toggle — grouped by program (default) vs flat all-creatives */}
      <div className="flex items-center gap-2 mb-4 text-[11px] sm:text-xs">
        <button
          onClick={() => setFlatView(false)}
          className={`px-2.5 py-1 rounded-lg font-medium transition-colors ${
            !flatView ? "bg-indigo-600 text-white" : "text-gray-400 hover:text-white hover:bg-gray-800"
          }`}
        >
          จัดกลุ่มตามโปรแกรม
        </button>
        <button
          onClick={() => setFlatView(true)}
          className={`px-2.5 py-1 rounded-lg font-medium transition-colors ${
            flatView ? "bg-indigo-600 text-white" : "text-gray-400 hover:text-white hover:bg-gray-800"
          }`}
        >
          ดูทั้งหมด (ไม่แบ่งกลุ่ม)
        </button>
        {flatView && <span className="text-[10px] text-gray-500">{visibleRows.length} ชิ้น</span>}
      </div>

      {/* Flat view — every creative in one grid, no program grouping */}
      {flatView && (
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8 gap-2">
          {visibleRows.map((row) => {
            const creative = creatives[row.groupKey];
            const isVideo = !!(creative?.videoId) || creative?.objectType === "VIDEO";
            return (
              <div
                key={row.groupKey}
                className="bg-gray-800 border border-gray-700 rounded-lg overflow-hidden hover:border-indigo-500 transition-colors cursor-pointer"
                onClick={() => creative?.thumbnailUrl && setModal({
                  thumbnailUrl: creative.thumbnailUrl, isVideo,
                  groupKey: row.groupKey, program: row.program, sub: row.sub,
                  spend: row.spend, inbox: row.inbox, cpi: row.cpi,
                  leads: row.leads, cpl: row.cpl, branchCount: row.branchCount,
                })}
              >
                <div className="relative w-full bg-gray-900 overflow-hidden" style={{aspectRatio: "4 / 3"}}>
                  <div className="w-full h-full">
                    {creative?.thumbnailUrl ? (
                      <>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={proxyUrl(creative.thumbnailUrl)} alt={row.awCodeBase} className="w-full h-full object-cover" />
                        {isVideo && (
                          <div className="absolute inset-0 flex items-center justify-center">
                            <div className="bg-black/60 rounded-full p-1.5"><Play className="w-4 h-4 text-white fill-white" /></div>
                          </div>
                        )}
                      </>
                    ) : loading ? (
                      <div className="w-full h-full bg-slate-800/80 animate-pulse flex items-center justify-center">
                        <div className="w-8 h-8 rounded bg-slate-700/40" />
                      </div>
                    ) : (
                      <div className="w-full h-full flex flex-col items-center justify-center text-gray-600">
                        <ImageIcon className="w-5 h-5 mb-1" /><span className="text-[10px]">โหลดไม่ได้</span>
                      </div>
                    )}
                    <div className="absolute top-1 right-1">
                      <span className={`text-[9px] px-1 py-0.5 rounded font-medium ${
                        creative?.objectType === "BOOST_POST" ? "bg-gray-600 text-white"
                        : isVideo ? "bg-purple-600 text-white" : "bg-blue-600 text-white"
                      }`}>
                        {creative?.objectType === "BOOST_POST" ? "Boost" : isVideo ? "VDO" : "IMG"}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="p-1.5 space-y-0.5">
                  <p className="text-[11px] font-mono text-indigo-300 truncate">{row.awCodeBase}-{row.creativeId}</p>
                  <p className="text-[10px] text-gray-400 truncate">
                    {row.program}{row.sub && row.sub !== "รวม" ? ` ${row.sub}` : ""}
                    {row.branchCount > 1 ? ` (${row.branchCount} สาขา)` : ""}
                  </p>
                  <div className="grid grid-cols-2 gap-x-1 pt-0.5 border-t border-gray-700">
                    <div><p className="text-[9px] text-gray-500">Spend</p><p className="text-[10px] font-medium text-emerald-400">{fmtB(row.spend)}</p></div>
                    <div><p className="text-[9px] text-gray-500">Inbox</p><p className="text-[10px] font-medium text-purple-400">{fmt(row.inbox)}</p></div>
                    <div><p className="text-[9px] text-gray-500">CPI</p><p className="text-[10px] font-medium text-yellow-400">{hasReliableMetric(row, "cpi") ? fmtB(row.cpi) : "น้อย"}</p></div>
                    <div><p className="text-[9px] text-gray-500">CPL</p><p className="text-[10px] font-medium text-pink-400">{hasReliableMetric(row, "cpl") ? fmtB(row.cpl) : "น้อย"}</p></div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Hero section — one program group per row */}
      {!flatView && (
      <div className="space-y-4">
        {programList.map(([program, progRows]) => {
          const top3 = progRows.slice(0, 3);
          const isExpanded = expandedPrograms.has(program);
          const totalSpend = progRows.reduce((s, r) => s + r.spend, 0);
          const totalInbox = progRows.reduce((s, r) => s + r.inbox, 0);
          const totalLeads = progRows.reduce((s, r) => s + r.leads, 0);
          const totalCPI = totalInbox > 0 ? totalSpend / totalInbox : 0;
          const totalCPL = totalLeads > 0 ? totalSpend / totalLeads : 0;
          const medals = ["🥇", "🥈", "🥉"];

          return (
            <div key={program} className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
              {/* Desktop: horizontal (thumbnails left + info right). Mobile: stacked vertical */}
              <div
                className="flex flex-col sm:flex-row gap-3 p-3 cursor-pointer hover:bg-gray-800/30 transition-colors"
                onClick={() => toggleProgram(program)}
              >
                {/* Top 3 thumbnails */}
                <div className="flex gap-2 flex-shrink-0">
                  {top3.map((row, idx) => {
                    const c = creatives[row.groupKey];
                    const isVid = !!(c?.videoId) || c?.objectType === "VIDEO";
                    return (
                      <div key={row.groupKey} className="relative w-24 h-24 sm:w-28 sm:h-28 bg-gray-800 rounded-xl overflow-hidden flex-shrink-0">
                        {c?.thumbnailUrl ? (
                          <>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={proxyUrl(c.thumbnailUrl)} alt={row.groupKey} className="w-full h-full object-cover" />
                            {isVid && (
                              <div className="absolute inset-0 flex items-center justify-center">
                                <div className="bg-black/60 rounded-full p-1"><Play className="w-3 h-3 text-white fill-white" /></div>
                              </div>
                            )}
                          </>
                        ) : loading ? (
                          <div className="w-full h-full bg-slate-800/80 animate-pulse flex items-center justify-center">
                            <div className="w-8 h-8 rounded bg-slate-700/40" />
                          </div>
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-gray-600"><ImageIcon className="w-5 h-5" /></div>
                        )}
                        <div className="absolute top-0.5 left-0.5 text-sm leading-none">{medals[idx]}</div>
                        {row.branchCount > 1 && (
                          <div className="absolute top-1 right-1 text-[10px] bg-slate-900/80 text-slate-200 px-1 rounded-full">{row.branchCount}สาขา</div>
                        )}
                        <div className="absolute bottom-0 left-0 right-0 bg-black/70 px-1 py-0.5">
                          <p className="text-[10px] font-mono text-indigo-300 truncate">{row.groupKey}</p>
                          <p className="text-[10px] text-emerald-400 font-semibold">
                            {sortBy === "cpi" ? (hasReliableMetric(row, "cpi") ? fmtB(row.cpi) : "ข้อมูลน้อย")
                              : sortBy === "cpl" ? (hasReliableMetric(row, "cpl") ? fmtB(row.cpl) : "ข้อมูลน้อย")
                              : sortBy === "inbox" ? fmt(row.inbox)
                              : sortBy === "leads" ? fmt(row.leads)
                              : fmtB(row.spend)}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Program info — beside thumbnails on desktop, below on mobile */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-white font-bold text-sm sm:text-base truncate">{program}</span>
                    <span className="text-[11px] bg-gray-700 text-gray-300 px-2 py-0.5 rounded-full flex-shrink-0">{progRows.length}</span>
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs">
                    <span className="text-gray-500">Spend <span className="text-emerald-400 font-semibold">{fmtB(totalSpend)}</span></span>
                    <span className="text-gray-500">Inbox <span className="text-purple-400 font-semibold">{fmt(totalInbox)}</span></span>
                    <span className="text-gray-500">CPI <span className="text-amber-300 font-semibold">{totalInbox > 0 ? fmtB(totalCPI) : "-"}</span></span>
                    <span className="text-gray-500">CPL <span className="text-pink-400 font-semibold">{totalLeads > 0 ? fmtB(totalCPL) : "-"}</span></span>
                  </div>
                </div>

                {/* Expand icon */}
                <div className="hidden sm:flex items-center flex-shrink-0">
                  {isExpanded ? <ChevronUp className="w-5 h-5 text-gray-400" /> : <ChevronDown className="w-5 h-5 text-gray-400" />}
                </div>
              </div>

              {/* Expanded creative grid */}
              {isExpanded && (
                <div className="border-t border-gray-800 p-4">
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                    {progRows.map((row) => {
                      const creative = creatives[row.groupKey];
                      const isVideo = !!(creative?.videoId) || creative?.objectType === "VIDEO";
                      return (
                        <div
                          key={row.groupKey}
                          className="bg-gray-800 border border-gray-700 rounded-xl overflow-hidden hover:border-indigo-500 transition-colors cursor-pointer"
                          onClick={() => creative?.thumbnailUrl && setModal({
                            thumbnailUrl: creative.thumbnailUrl, isVideo,
                            groupKey: row.groupKey, program: row.program, sub: row.sub,
                            spend: row.spend, inbox: row.inbox, cpi: row.cpi,
                            leads: row.leads, cpl: row.cpl, branchCount: row.branchCount,
                          })}
                        >
                          <div className="relative w-full bg-gray-900 overflow-hidden" style={{aspectRatio: "1 / 1"}}>
                            <div className="w-full h-full">
                              {creative?.thumbnailUrl ? (
                                <>
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img src={proxyUrl(creative.thumbnailUrl)} alt={row.awCodeBase} className="w-full h-full object-cover" />
                                  {isVideo && (
                                    <div className="absolute inset-0 flex items-center justify-center">
                                      <div className="bg-black/60 rounded-full p-2"><Play className="w-5 h-5 text-white fill-white" /></div>
                                    </div>
                                  )}
                                </>
                              ) : loading ? (
                                <div className="w-full h-full bg-slate-800/80 animate-pulse flex items-center justify-center">
                                  <div className="w-10 h-10 rounded bg-slate-700/40" />
                                </div>
                              ) : (
                                <div className="w-full h-full flex flex-col items-center justify-center text-gray-600">
                                  <ImageIcon className="w-7 h-7 mb-1" /><span className="text-xs">โหลดไม่ได้</span>
                                </div>
                              )}
                              <div className="absolute top-1.5 right-1.5">
                                <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                                  creative?.objectType === "BOOST_POST" ? "bg-gray-600 text-white"
                                  : isVideo ? "bg-purple-600 text-white" : "bg-blue-600 text-white"
                                }`}>
                                  {creative?.objectType === "BOOST_POST" ? "Boost" : isVideo ? "VDO" : "IMG"}
                                </span>
                              </div>
                            </div>
                          </div>
                          <div className="p-2 space-y-0.5">
                            <p className="text-xs font-mono text-indigo-300 truncate">{row.awCodeBase}-{row.creativeId}</p>
                            <p className="text-xs text-gray-400 truncate">{row.sub && row.sub !== "รวม" ? row.sub : ""}{row.branchCount > 1 ? ` (${row.branchCount} สาขา)` : ""}</p>
                            {(!hasReliableMetric(row, "cpi") || !hasReliableMetric(row, "cpl")) && (
                              <p className="text-[10px] text-slate-500">ข้อมูลน้อยสำหรับการตัดสินผล</p>
                            )}
                            <div className="grid grid-cols-2 gap-x-1.5 pt-1 border-t border-gray-700">
                              <div><p className="text-xs text-gray-500">Spend</p><p className="text-xs font-medium text-emerald-400">{fmtB(row.spend)}</p></div>
                              <div><p className="text-xs text-gray-500">Inbox</p><p className="text-xs font-medium text-purple-400">{fmt(row.inbox)}</p></div>
                              <div><p className="text-xs text-gray-500">CPI</p><p className="text-xs font-medium text-yellow-400">{hasReliableMetric(row, "cpi") ? fmtB(row.cpi) : "ข้อมูลน้อย"}</p></div>
                              <div><p className="text-xs text-gray-500">CPL</p><p className="text-xs font-medium text-pink-400">{hasReliableMetric(row, "cpl") ? fmtB(row.cpl) : "ข้อมูลน้อย"}</p></div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
      )}
    </div>
  );
}
