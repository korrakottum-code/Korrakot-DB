"use client";

import { COLORS } from "./theme";
import type { GroupedRow, TabKey } from "./types";

interface Props {
  rows: GroupedRow[];
  tab: "branch" | "program" | "creative";
  sort: { col: string; dir: "asc" | "desc" };
  onSort: (col: string) => void;
  onProgramDrill?: (name: string) => void;
}

function fmt(n: number) {
  return n.toLocaleString("th-TH", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}
function fmtB(n: number) {
  if (n >= 1_000_000) return `฿${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `฿${(n / 1_000).toFixed(1)}K`;
  return `฿${n.toFixed(0)}`;
}

const columns = ["name", "spend", "impressions", "inbox", "cpi", "leads", "cpl"] as const;

export default function SortableMetricTable({ rows, tab, sort, onSort, onProgramDrill }: Props) {
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
              <td className="py-2 px-2 sm:px-3 text-right font-medium text-emerald-400">{fmtB(row.spend)}</td>
              <td className="py-2 px-2 sm:px-3 text-right text-gray-300">{fmt(row.impressions)}</td>
              <td className="py-2 px-2 sm:px-3 text-right text-gray-300">{fmt(row.inbox)}</td>
              <td className="py-2 px-2 sm:px-3 text-right text-gray-300">{row.inbox > 0 ? `฿${row.cpi.toFixed(0)}` : "-"}</td>
              <td className="py-2 px-2 sm:px-3 text-right text-gray-300">{fmt(row.leads)}</td>
              <td className="py-2 px-2 sm:px-3 text-right text-gray-300">{row.leads > 0 ? `฿${row.cpl.toFixed(0)}` : "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
