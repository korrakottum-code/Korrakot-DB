"use client";

import type { AdInsight } from "@/lib/meta";
import { DollarSign, Eye, MousePointer, TrendingUp } from "lucide-react";

function fmt(n: number) {
  return n.toLocaleString("th-TH", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}
function fmtB(n: number) {
  if (n >= 1_000_000) return `฿${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `฿${(n / 1_000).toFixed(1)}K`;
  return `฿${n.toFixed(0)}`;
}

interface Props {
  insights: AdInsight[];
  filterSummary?: string;
}

export default function KpiCards({ insights, filterSummary }: Props) {
  const totalSpend = insights.reduce((s, i) => s + i.spend, 0);
  const totalImpressions = insights.reduce((s, i) => s + i.impressions, 0);
  const totalInbox = insights.reduce((s, i) => s + i.inbox, 0);
  const totalLeads = insights.reduce((s, i) => s + i.leads, 0);
  const avgCPI = totalInbox > 0 ? totalSpend / totalInbox : 0;
  const avgCPL = totalLeads > 0 ? totalSpend / totalLeads : 0;

  const cards = [
    { label: "ยอดใช้จ่าย", value: fmtB(totalSpend), icon: DollarSign, color: "text-emerald-400", tint: "bg-emerald-500/15" },
    { label: "Impressions", value: fmt(totalImpressions), icon: Eye, color: "text-sky-400", tint: "bg-sky-500/15" },
    { label: "Inbox", value: fmt(totalInbox), icon: MousePointer, color: "text-purple-400", tint: "bg-purple-500/15" },
    { label: "CPI", value: totalInbox > 0 ? `฿${avgCPI.toFixed(0)}` : "-", icon: TrendingUp, color: "text-amber-400", tint: "bg-amber-500/15" },
    { label: "Leads", value: fmt(totalLeads), icon: MousePointer, color: "text-blue-400", tint: "bg-blue-500/15" },
    { label: "CPL", value: totalLeads > 0 ? `฿${avgCPL.toFixed(0)}` : "-", icon: DollarSign, color: "text-pink-400", tint: "bg-pink-500/15" },
  ];

  const context = filterSummary?.trim();

  return (
    <div className="space-y-3">
      {context && (
        <div className="flex items-center gap-2">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-800/70 border border-slate-700 text-xs text-slate-200">
            <span className="text-slate-400">กำลังแสดง</span>
            <span className="font-medium text-white">{context}</span>
          </div>
        </div>
      )}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3 md:gap-4">
        {cards.map((card) => (
          <div
            key={card.label}
            className="bg-gradient-to-br from-slate-900 to-slate-850 border border-slate-800/80 rounded-xl p-3 md:p-4 shadow-lg shadow-black/20 flex flex-col gap-2"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center ${card.tint}`}>
                  <card.icon className={`w-4 h-4 ${card.color}`} />
                </div>
                <span className="text-xs text-slate-300">{card.label}</span>
              </div>
            </div>
            <div className="text-xl md:text-2xl font-bold text-white">{card.value}</div>
          </div>
        ))}
      </div>
      {context && (
        <div className="fixed bottom-4 right-4 sm:hidden z-20">
          <div className="px-3 py-2 rounded-lg bg-slate-900/90 border border-slate-700 text-[11px] text-slate-200 shadow-lg shadow-black/30">
            {context}
          </div>
        </div>
      )}
    </div>
  );
}
