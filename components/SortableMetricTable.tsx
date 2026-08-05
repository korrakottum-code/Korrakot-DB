"use client";

import { COLORS } from "./theme";
import type { GroupedRow } from "./types";

interface Props {
  rows: GroupedRow[];
  tab: "branch" | "program" | "creative";
  sort: { col: string; dir: "asc" | "desc" };
  onSort: (col: string) => void;
  onProgramDrill?: (name: string) => void;
  showComparison?: boolean;
}

function fmt(n: number) {
  return n.toLocaleString("th-TH", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}
function fmtB(n: number) {
  if (n >= 1_000_000) return `฿${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `฿${(n / 1_000).toFixed(1)}K`;
  return `฿${n.toFixed(0)}`;
}

function renderDiffBadge(current: number, previous?: number, lowerIsBetter = false) {
  if (previous === undefined || previous === 0) return null;
  const pct = ((current - previous) / previous) * 100;
  if (Math.abs(pct) < 0.1) return null;
  const isPos = pct > 0;
  const color = isPos
    ? (lowerIsBetter ? "text-rose-400" : "text-emerald-400")
    : (lowerIsBetter ? "text-emerald-400" : "text-rose-400");
  const sign = isPos ? "+" : "";
  const arrow = isPos ? "▲" : "▼";
  return (
    <span className={`text-[10px] font-semibold ${color} ml-1`}>
      {arrow}{sign}{pct.toFixed(0)}%
    </span>
  );
}

const columns = ["name", "spend", "impressions", "inbox", "cpi", "leads", "cpl"] as const;

export default function SortableMetricTable({ rows, tab, sort, onSort, onProgramDrill, showComparison = false }: Props) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs sm:text-sm">
        <thead className="sticky top-0 bg-gray-900 z-10">
          <tr className="border-b border-gray-800">
            <th className="text-left py-2 px-2 sm:px-3 text-gray-400 font-medium w-8">#</th>
            {columns.map((col) => (
              <th
                key={col}
                onClick={() => onSort(col)}
                className={`py-2 px-2 sm:px-3 text-gray-400 font-medium cursor-pointer select-none hover:text-white transition-colors ${
                  col === "name" ? "text-left md:sticky md:left-8 md:bg-gray-900 z-10" : "text-right"
                }`}
              >
                <span className={`inline-flex items-center gap-1 ${col === "name" ? "" : "justify-end w-full"}`}>
                  {col === "name"
                    ? "ชื่อ"
                    : col === "spend"
                      ? "ยอดใช้จ่าย"
                      : col === "impressions"
                        ? "Impressions"
                        : col === "inbox"
                          ? "Inbox"
                          : col === "cpi"
                            ? "CPI"
                            : col === "leads"
                              ? "Leads"
                              : "CPL"}
                  {sort.col === col ? (sort.dir === "desc" ? " ↓" : " ↑") : " ↕"}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={row.name} className="border-b border-gray-800/50 hover:bg-gray-800/30">
              <td className="py-2 px-2 sm:px-3 text-gray-500 text-[11px] sm:text-xs">{i + 1}</td>
              <td className="py-2 px-2 sm:px-3 flex items-center gap-2 md:sticky md:left-8 md:bg-gray-900">
                <span
                  className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                  style={{ backgroundColor: COLORS[i % COLORS.length] }}
                />
                <span
                  className={tab === "program" ? "cursor-pointer hover:text-indigo-300 transition-colors" : ""}
                  onClick={tab === "program" && onProgramDrill ? (e) => {
                    e.stopPropagation();
                    onProgramDrill(row.name);
                  } : undefined}
                >
                  {row.name}
                  {tab === "program" && <span className="ml-1 text-indigo-400 text-[10px] sm:text-xs">→</span>}
                </span>
              </td>
              {/* Spend */}
              <td className="py-2 px-2 sm:px-3 text-right">
                <div className="font-medium text-emerald-400">
                  {fmtB(row.spend)}
                  {showComparison && renderDiffBadge(row.spend, row.prevSpend)}
                </div>
                {showComparison && row.prevSpend !== undefined && (
                  <div className="text-[10px] text-slate-500">ช่วงก่อน: {fmtB(row.prevSpend)}</div>
                )}
              </td>
              {/* Impressions */}
              <td className="py-2 px-2 sm:px-3 text-right">
                <div className="text-gray-300">
                  {fmt(row.impressions)}
                  {showComparison && renderDiffBadge(row.impressions, row.prevImpressions)}
                </div>
                {showComparison && row.prevImpressions !== undefined && (
                  <div className="text-[10px] text-slate-500">ช่วงก่อน: {fmt(row.prevImpressions)}</div>
                )}
              </td>
              {/* Inbox */}
              <td className="py-2 px-2 sm:px-3 text-right">
                <div className="text-gray-300">
                  {fmt(row.inbox)}
                  {showComparison && renderDiffBadge(row.inbox, row.prevInbox)}
                </div>
                {showComparison && row.prevInbox !== undefined && (
                  <div className="text-[10px] text-slate-500">ช่วงก่อน: {fmt(row.prevInbox)}</div>
                )}
              </td>
              {/* CPI */}
              <td className="py-2 px-2 sm:px-3 text-right">
                <div className="text-gray-300">
                  {row.inbox > 0 ? `฿${row.cpi.toFixed(0)}` : "-"}
                  {showComparison && row.inbox > 0 && row.prevCpi ? renderDiffBadge(row.cpi, row.prevCpi, true) : null}
                </div>
                {showComparison && row.prevCpi !== undefined && (
                  <div className="text-[10px] text-slate-500">
                    ช่วงก่อน: {row.prevInbox && row.prevInbox > 0 ? `฿${row.prevCpi.toFixed(0)}` : "-"}
                  </div>
                )}
              </td>
              {/* Leads */}
              <td className="py-2 px-2 sm:px-3 text-right">
                <div className="text-gray-300">
                  {fmt(row.leads)}
                  {showComparison && renderDiffBadge(row.leads, row.prevLeads)}
                </div>
                {showComparison && row.prevLeads !== undefined && (
                  <div className="text-[10px] text-slate-500">ช่วงก่อน: {fmt(row.prevLeads)}</div>
                )}
              </td>
              {/* CPL */}
              <td className="py-2 px-2 sm:px-3 text-right">
                <div className="text-gray-300">
                  {row.leads > 0 ? `฿${row.cpl.toFixed(0)}` : "-"}
                  {showComparison && row.leads > 0 && row.prevCpl ? renderDiffBadge(row.cpl, row.prevCpl, true) : null}
                </div>
                {showComparison && row.prevCpl !== undefined && (
                  <div className="text-[10px] text-slate-500">
                    ช่วงก่อน: {row.prevLeads && row.prevLeads > 0 ? `฿${row.prevCpl.toFixed(0)}` : "-"}
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

