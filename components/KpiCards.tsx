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

function renderChangeIndicator(current: number, previous: number, lowerIsBetter = false) {
  if (!previous) return null;
  const pct = ((current - previous) / previous) * 100;
  const isZero = Math.abs(pct) < 0.1;
  const isPositive = pct > 0;

  let colorClass = "";
  if (isZero) {
    colorClass = "text-slate-400";
  } else if (isPositive) {
    colorClass = lowerIsBetter ? "text-rose-400" : "text-emerald-400";
  } else {
    colorClass = lowerIsBetter ? "text-emerald-400" : "text-rose-400";
  }

  const sign = isPositive ? "+" : "";
  const arrow = isPositive ? "▲" : isZero ? "•" : "▼";

  return (
    <span className={`text-[11px] font-bold inline-flex items-center gap-0.5 ml-1.5 ${colorClass}`}>
      {arrow} {sign}{pct.toFixed(1)}%
    </span>
  );
}

interface Props {
  insights: AdInsight[];
  prevInsights?: AdInsight[];
  filterSummary?: string;
}

export default function KpiCards({ insights, prevInsights = [], filterSummary }: Props) {
  const totalSpend = insights.reduce((s, i) => s + i.spend, 0);
  const totalImpressions = insights.reduce((s, i) => s + i.impressions, 0);
  const totalInbox = insights.reduce((s, i) => s + i.inbox, 0);
  const totalLeads = insights.reduce((s, i) => s + i.leads, 0);
  const avgCPI = totalInbox > 0 ? totalSpend / totalInbox : 0;
  const avgCPL = totalLeads > 0 ? totalSpend / totalLeads : 0;

  // Previous period metrics
  const prevTotalSpend = prevInsights.reduce((s, i) => s + i.spend, 0);
  const prevTotalImpressions = prevInsights.reduce((s, i) => s + i.impressions, 0);
  const prevTotalInbox = prevInsights.reduce((s, i) => s + i.inbox, 0);
  const prevTotalLeads = prevInsights.reduce((s, i) => s + i.leads, 0);
  const prevAvgCPI = prevTotalInbox > 0 ? prevTotalSpend / prevTotalInbox : 0;
  const prevAvgCPL = prevTotalLeads > 0 ? prevTotalSpend / prevTotalLeads : 0;

  const cards = [
    { 
      label: "ยอดใช้จ่าย", 
      value: fmtB(totalSpend), 
      icon: DollarSign, 
      color: "text-emerald-400", 
      tint: "bg-emerald-500/15",
      change: renderChangeIndicator(totalSpend, prevTotalSpend) 
    },
    { 
      label: "Impressions", 
      value: fmt(totalImpressions), 
      icon: Eye, 
      color: "text-sky-400", 
      tint: "bg-sky-500/15",
      change: renderChangeIndicator(totalImpressions, prevTotalImpressions)
    },
    { 
      label: "Inbox", 
      value: fmt(totalInbox), 
      icon: MousePointer, 
      color: "text-purple-400", 
      tint: "bg-purple-500/15",
      change: renderChangeIndicator(totalInbox, prevTotalInbox)
    },
    { 
      label: "CPI", 
      value: totalInbox > 0 ? `฿${avgCPI.toFixed(0)}` : "-", 
      icon: TrendingUp, 
      color: "text-amber-400", 
      tint: "bg-amber-500/15",
      change: renderChangeIndicator(avgCPI, prevAvgCPI, true)
    },
    { 
      label: "Leads", 
      value: fmt(totalLeads), 
      icon: MousePointer, 
      color: "text-blue-400", 
      tint: "bg-blue-500/15",
      change: renderChangeIndicator(totalLeads, prevTotalLeads)
    },
    { 
      label: "CPL", 
      value: totalLeads > 0 ? `฿${avgCPL.toFixed(0)}` : "-", 
      icon: DollarSign, 
      color: "text-pink-400", 
      tint: "bg-pink-500/15",
      change: renderChangeIndicator(avgCPL, prevAvgCPL, true)
    },
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
            <div className="flex items-baseline flex-wrap gap-x-1.5 gap-y-0.5">
              <div className="text-xl md:text-2xl font-bold text-white">{card.value}</div>
              {card.change}
            </div>
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
