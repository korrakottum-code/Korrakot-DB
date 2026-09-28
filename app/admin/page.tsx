"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw, MessageCircle, Download, DatabaseZap } from "lucide-react";
import LogoutButton from "@/components/LogoutButton";
import { todayBangkokDateStr } from "@/lib/pancake";
import { csvLine } from "@/lib/report-export";

interface PageStat {
  pageId: string;
  name: string;
  count: number;
  medianMinutes: number | null;
  avgMinutes: number | null;
}

interface AdminStat {
  adminId: string;
  adminName: string;
  count: number;
  medianMinutes: number | null;
  avgMinutes: number | null;
}

type View = "branch" | "admin";

function fmtMin(v: number | null) {
  return v === null ? "-" : v.toFixed(1);
}

// สีไล่ตามความช้า — median ยิ่งมาก ยิ่งแดง (เกณฑ์คร่าวๆ จากข้อมูลจริงที่เจอ ไม่ใช่ SLA ทางการ)
function medianColor(v: number | null) {
  if (v === null) return "text-gray-400";
  if (v >= 10) return "text-rose-400";
  if (v >= 3) return "text-amber-400";
  return "text-emerald-400";
}

const TODAY = todayBangkokDateStr();

/** เลื่อนวันที่ (YYYY-MM-DD) ไป N วัน — คำนวณเป็นวันปฏิทินล้วนๆ ไม่ต้องยุ่งกับ timezone instant เพราะ TODAY มาจาก Bangkok อยู่แล้ว */
function shiftDateStr(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const shifted = new Date(Date.UTC(y, m - 1, d + days));
  return shifted.toISOString().slice(0, 10);
}

function startOfMonthStr(dateStr: string): string {
  const [y, m] = dateStr.split("-");
  return `${y}-${m}-01`;
}

const THIS_MONTH_START = startOfMonthStr(TODAY);
const LAST_MONTH_END = shiftDateStr(THIS_MONTH_START, -1);
const LAST_MONTH_START = startOfMonthStr(LAST_MONTH_END);

const QUICK_PRESETS: { label: string; since: string; until: string }[] = [
  { label: "วันนี้", since: TODAY, until: TODAY },
  { label: "เมื่อวาน", since: shiftDateStr(TODAY, -1), until: shiftDateStr(TODAY, -1) },
  { label: "2 วันก่อน", since: shiftDateStr(TODAY, -2), until: shiftDateStr(TODAY, -2) },
  { label: "3 วันก่อน", since: shiftDateStr(TODAY, -3), until: shiftDateStr(TODAY, -3) },
  { label: "7 วันก่อน", since: shiftDateStr(TODAY, -7), until: shiftDateStr(TODAY, -7) },
  { label: "เดือนนี้", since: THIS_MONTH_START, until: TODAY },
  { label: "เดือนที่แล้ว", since: LAST_MONTH_START, until: LAST_MONTH_END },
];

export default function AdminResponseTimePage() {
  const [since, setSince] = useState(TODAY);
  const [until, setUntil] = useState(TODAY);
  const [view, setView] = useState<View>("branch");
  const [pages, setPages] = useState<PageStat[]>([]);
  const [byAdmin, setByAdmin] = useState<AdminStat[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState("");
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);

  const load = useCallback(async (forSince: string, forUntil: string) => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/admin/response-time?since=${forSince}&until=${forUntil}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "โหลดข้อมูลไม่สำเร็จ");
      setPages(data.pages || []);
      setByAdmin(data.byAdmin || []);
      setLastSyncedAt(data.lastSyncedAt || null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "โหลดข้อมูลไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load(since, until);
  }, [load, since, until]);

  const syncNow = useCallback(async () => {
    setSyncing(true);
    setError("");
    try {
      const res = await fetch("/api/admin/sync-pancake-now", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "ซิงก์ไม่สำเร็จ");
      await load(since, until);
    } catch (err) {
      setError(err instanceof Error ? err.message : "ซิงก์ไม่สำเร็จ");
    } finally {
      setSyncing(false);
    }
  }, [load, since, until]);

  const totalWithMsg = useMemo(() => pages.reduce((s, p) => s + p.count, 0), [pages]);
  const totalAnswered = useMemo(() => byAdmin.reduce((s, a) => s + a.count, 0), [byAdmin]);

  const exportCsv = useCallback(() => {
    const header = view === "branch"
      ? ["สาขา", "ตอบกี่ครั้ง", "median(นาที)", "avg(นาที)"]
      : ["แอดมิน", "ตอบกี่ครั้ง", "median(นาที)", "avg(นาที)"];
    const rows: unknown[][] = view === "branch"
      ? pages.map((p) => [p.name, p.count, p.medianMinutes ?? "", p.avgMinutes ?? ""])
      : byAdmin.map((a) => [a.adminName, a.count, a.medianMinutes ?? "", a.avgMinutes ?? ""]);
    const csv = [header, ...rows].map(csvLine).join("\r\n");
    // ใส่ BOM ให้ Excel เปิดแล้วอ่านภาษาไทยไม่เพี้ยน
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `pancake-response-time-${view}-${since}_${until}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [view, pages, byAdmin, since, until]);

  const exportDisabled = view === "branch" ? pages.length === 0 : byAdmin.length === 0;

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <div className="max-w-5xl mx-auto px-3 sm:px-4 py-6">
        <div className="flex items-start justify-between flex-wrap gap-3 mb-1">
          <div>
            <h1 className="text-lg sm:text-xl font-bold flex items-center gap-2">
              <MessageCircle className="w-5 h-5 text-indigo-400 flex-shrink-0" />
              เวลาตอบแชท — Pancake
            </h1>
            {lastSyncedAt && (
              <p className="text-xs text-gray-400 mt-1">
                ข้อมูลซิงก์ล่าสุด {new Date(lastSyncedAt).toLocaleString("th-TH", { timeZone: "Asia/Bangkok", dateStyle: "short", timeStyle: "short" })}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={exportCsv}
              disabled={exportDisabled}
              className="flex items-center gap-1.5 sm:gap-2 px-3 py-2 bg-gray-800 hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg text-xs sm:text-sm font-medium transition-colors"
            >
              <Download className="w-4 h-4" />
              <span className="hidden xs:inline">Export CSV</span>
            </button>
            <button
              onClick={syncNow}
              disabled={syncing}
              title="ดึงบทสนทนาล่าสุดจาก Pancake มาเก็บลง DB ตอนนี้เลย (ปกติรันอัตโนมัติทุกคืน)"
              className="flex items-center gap-1.5 sm:gap-2 px-3 py-2 bg-gray-800 hover:bg-gray-700 disabled:opacity-50 rounded-lg text-xs sm:text-sm font-medium transition-colors"
            >
              <DatabaseZap className={`w-4 h-4 ${syncing ? "animate-pulse" : ""}`} />
              <span className="hidden xs:inline">{syncing ? "กำลังซิงก์..." : "ซิงก์ตอนนี้"}</span>
            </button>
            <button
              onClick={() => load(since, until)}
              disabled={loading}
              className="flex items-center gap-1.5 sm:gap-2 px-3 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded-lg text-xs sm:text-sm font-medium transition-colors"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
              <span className="hidden xs:inline">รีเฟรช</span>
            </button>
            <LogoutButton />
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap mb-3">
          <div className="flex gap-1 bg-gray-800 rounded-lg p-1 overflow-x-auto">
            {QUICK_PRESETS.map((p) => (
              <button
                key={p.label}
                onClick={() => { setSince(p.since); setUntil(p.until); }}
                className={`px-2.5 sm:px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap transition-colors ${
                  since === p.since && until === p.until ? "bg-indigo-600 text-white" : "text-gray-400 hover:text-white"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1.5">
            <input
              type="date"
              value={since}
              max={until}
              onChange={(e) => e.target.value && setSince(e.target.value)}
              className="px-3 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-xs sm:text-sm text-gray-200 [color-scheme:dark]"
            />
            <span className="text-gray-500 text-xs">–</span>
            <input
              type="date"
              value={until}
              min={since}
              max={TODAY}
              onChange={(e) => e.target.value && setUntil(e.target.value)}
              className="px-3 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-xs sm:text-sm text-gray-200 [color-scheme:dark]"
            />
          </div>
          <div className="flex gap-1 bg-gray-800 rounded-lg p-1">
            {([
              { key: "branch" as View, label: "รายสาขา" },
              { key: "admin" as View, label: "รายแอดมิน" },
            ]).map((v) => (
              <button
                key={v.key}
                onClick={() => setView(v.key)}
                className={`px-2.5 sm:px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  view === v.key ? "bg-indigo-600 text-white" : "text-gray-400 hover:text-white"
                }`}
              >
                {v.label}
              </button>
            ))}
          </div>
        </div>

        {error && (
          <div className="mt-4 p-3 rounded-lg bg-rose-950/50 border border-rose-800 text-rose-300 text-sm">
            {error}
          </div>
        )}

        {!error && view === "branch" && pages.length > 0 && (
          <p className="text-xs text-gray-400 mt-4 mb-2">
            รวม {pages.length} เพจ · ตอบไปทั้งหมด {totalWithMsg.toLocaleString("th-TH")} บทสนทนา
          </p>
        )}

        {!error && view === "admin" && byAdmin.length > 0 && (
          <p className="text-xs text-gray-400 mt-4 mb-2">
            แอดมิน {byAdmin.length} คน · ตอบไปทั้งหมด {totalAnswered.toLocaleString("th-TH")} บทสนทนา (รวมทุกสาขาในเครือ Class)
          </p>
        )}

        {!error && !loading && pages.length === 0 && byAdmin.length === 0 && (
          <div className="mb-3 p-2.5 rounded-lg bg-amber-950/40 border border-amber-800/60 text-amber-300 text-xs">
            ⚠️ ยังไม่มีข้อมูลที่เก็บไว้สำหรับช่วงนี้ — ระบบซิงก์ข้อมูลจาก Pancake มาเก็บถาวรทุกคืน
            ช่วงก่อนเริ่มเก็บจะมีเฉพาะเพจที่คุยไม่บ่อยจนบทสนทนายังค้างอยู่ใน &ldquo;ล่าสุด&rdquo; ของ Pancake ตอนซิงก์ครั้งแรกเท่านั้น
          </div>
        )}

        {view !== "branch" ? null : (
        <>
        {/* Mobile: การ์ดแนวตั้ง ไม่ต้องเลื่อนขวา */}
        <div className="sm:hidden space-y-2">
          {pages.map((p) => (
            <div key={p.pageId} className="rounded-xl border border-gray-800 bg-gray-900/60 p-3">
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-medium leading-snug">{p.name}</p>
                <div className={`text-lg font-bold ${medianColor(p.medianMinutes)} flex-shrink-0`}>
                  {fmtMin(p.medianMinutes)}
                  <span className="text-[10px] font-normal text-gray-500 ml-1">นาที</span>
                </div>
              </div>
              <div className="flex items-center gap-3 mt-1.5 text-[11px] text-gray-400">
                <span>ตอบ {p.count} ครั้ง</span>
                <span>avg {fmtMin(p.avgMinutes)} นาที</span>
              </div>
            </div>
          ))}
          {!loading && pages.length === 0 && !error && (
            <p className="py-8 text-center text-gray-500 text-sm">ไม่มีข้อมูล</p>
          )}
        </div>

        {/* Desktop/tablet: ตาราง */}
        <div className="hidden sm:block overflow-x-auto rounded-xl border border-gray-800">
          <table className="w-full text-sm">
            <thead className="bg-gray-900">
              <tr className="border-b border-gray-800 text-gray-400 text-xs">
                <th className="text-left py-2.5 px-3 font-medium">สาขา</th>
                <th className="text-right py-2.5 px-3 font-medium">ตอบกี่ครั้ง</th>
                <th className="text-right py-2.5 px-3 font-medium">median (นาที)</th>
                <th className="text-right py-2.5 px-3 font-medium">avg (นาที)</th>
              </tr>
            </thead>
            <tbody>
              {pages.map((p) => (
                <tr key={p.pageId} className="border-b border-gray-800/50 hover:bg-gray-900/50">
                  <td className="py-2 px-3">{p.name}</td>
                  <td className="py-2 px-3 text-right text-gray-300">{p.count}</td>
                  <td className={`py-2 px-3 text-right font-semibold ${medianColor(p.medianMinutes)}`}>
                    {fmtMin(p.medianMinutes)}
                  </td>
                  <td className="py-2 px-3 text-right text-gray-300">{fmtMin(p.avgMinutes)}</td>
                </tr>
              ))}
              {!loading && pages.length === 0 && !error && (
                <tr>
                  <td colSpan={4} className="py-8 text-center text-gray-500">
                    ไม่มีข้อมูล
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        </>
        )}

        {view === "admin" && (
        <>
        {/* Mobile: การ์ดแนวตั้ง */}
        <div className="sm:hidden space-y-2">
          {byAdmin.map((a) => (
            <div key={a.adminId} className="rounded-xl border border-gray-800 bg-gray-900/60 p-3">
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-medium leading-snug">{a.adminName}</p>
                <div className={`text-lg font-bold ${medianColor(a.medianMinutes)} flex-shrink-0`}>
                  {fmtMin(a.medianMinutes)}
                  <span className="text-[10px] font-normal text-gray-500 ml-1">นาที</span>
                </div>
              </div>
              <div className="flex items-center gap-3 mt-1.5 text-[11px] text-gray-400">
                <span>ตอบ {a.count} ครั้ง</span>
                <span>avg {fmtMin(a.avgMinutes)} นาที</span>
              </div>
            </div>
          ))}
          {!loading && byAdmin.length === 0 && !error && (
            <p className="py-8 text-center text-gray-500 text-sm">ไม่มีข้อมูล</p>
          )}
        </div>

        {/* Desktop/tablet: ตาราง */}
        <div className="hidden sm:block overflow-x-auto rounded-xl border border-gray-800">
          <table className="w-full text-sm">
            <thead className="bg-gray-900">
              <tr className="border-b border-gray-800 text-gray-400 text-xs">
                <th className="text-left py-2.5 px-3 font-medium">แอดมิน</th>
                <th className="text-right py-2.5 px-3 font-medium">ตอบกี่ครั้ง</th>
                <th className="text-right py-2.5 px-3 font-medium">median (นาที)</th>
                <th className="text-right py-2.5 px-3 font-medium">avg (นาที)</th>
              </tr>
            </thead>
            <tbody>
              {byAdmin.map((a) => (
                <tr key={a.adminId} className="border-b border-gray-800/50 hover:bg-gray-900/50">
                  <td className="py-2 px-3">{a.adminName}</td>
                  <td className="py-2 px-3 text-right text-gray-300">{a.count}</td>
                  <td className={`py-2 px-3 text-right font-semibold ${medianColor(a.medianMinutes)}`}>
                    {fmtMin(a.medianMinutes)}
                  </td>
                  <td className="py-2 px-3 text-right text-gray-300">{fmtMin(a.avgMinutes)}</td>
                </tr>
              ))}
              {!loading && byAdmin.length === 0 && !error && (
                <tr>
                  <td colSpan={4} className="py-8 text-center text-gray-500">
                    ไม่มีข้อมูล
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        </>
        )}
      </div>
    </div>
  );
}
