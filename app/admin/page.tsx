"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw, MessageCircle } from "lucide-react";
import LogoutButton from "@/components/LogoutButton";
import { todayBangkokDateStr } from "@/lib/pancake";

interface PageStat {
  pageId: string;
  name: string;
  conversationsFetched: number;
  withCustomerMsg: number;
  noStaffSeenYet: number;
  sampleWithGap: number;
  medianMinutes: number | null;
  avgMinutes: number | null;
  oldestConversationAt: string | null;
  coverageIncomplete: boolean;
  error?: string;
}

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

export default function AdminResponseTimePage() {
  const [date, setDate] = useState(TODAY);
  const [pages, setPages] = useState<PageStat[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);

  const load = useCallback(async (forDate: string, forceRefresh = false) => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/admin/response-time?date=${forDate}${forceRefresh ? "&refresh=1" : ""}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "โหลดข้อมูลไม่สำเร็จ");
      setPages(data.pages || []);
      setFetchedAt(data.fetchedAt || null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "โหลดข้อมูลไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load(date);
  }, [load, date]);

  const totalWithMsg = pages.reduce((s, p) => s + p.withCustomerMsg, 0);
  const totalNoSeen = pages.reduce((s, p) => s + p.noStaffSeenYet, 0);
  const anyIncomplete = pages.some((p) => p.coverageIncomplete);

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <div className="max-w-5xl mx-auto px-3 sm:px-4 py-6">
        <div className="flex items-start justify-between flex-wrap gap-3 mb-1">
          <div>
            <h1 className="text-lg sm:text-xl font-bold flex items-center gap-2">
              <MessageCircle className="w-5 h-5 text-indigo-400 flex-shrink-0" />
              เวลาตอบแชท — Pancake
            </h1>
            {fetchedAt && (
              <p className="text-xs text-gray-400 mt-1">
                ดึงเมื่อ {new Date(fetchedAt).toLocaleTimeString("th-TH", { timeZone: "Asia/Bangkok" })}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {date !== TODAY && (
              <button
                onClick={() => setDate(TODAY)}
                className="px-3 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-xs sm:text-sm font-medium transition-colors"
              >
                วันนี้
              </button>
            )}
            <input
              type="date"
              value={date}
              max={TODAY}
              onChange={(e) => e.target.value && setDate(e.target.value)}
              className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-xs sm:text-sm text-gray-200 [color-scheme:dark]"
            />
            <button
              onClick={() => load(date, true)}
              disabled={loading}
              className="flex items-center gap-1.5 sm:gap-2 px-3 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded-lg text-xs sm:text-sm font-medium transition-colors"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
              <span className="hidden xs:inline">รีเฟรช</span>
            </button>
            <LogoutButton />
          </div>
        </div>

        {error && (
          <div className="mt-4 p-3 rounded-lg bg-rose-950/50 border border-rose-800 text-rose-300 text-sm">
            {error}
          </div>
        )}

        {!error && pages.length > 0 && (
          <p className="text-xs text-gray-400 mt-4 mb-2">
            รวม {pages.length} เพจ · บทสนทนาที่ลูกค้าทักมา {totalWithMsg.toLocaleString("th-TH")} ·
            ยังไม่มีแอดมินเปิดดูเลย {totalNoSeen.toLocaleString("th-TH")}
            {totalWithMsg > 0 && ` (${((totalNoSeen / totalWithMsg) * 100).toFixed(1)}%)`}
          </p>
        )}

        {!error && anyIncomplete && (
          <div className="mb-3 p-2.5 rounded-lg bg-amber-950/40 border border-amber-800/60 text-amber-300 text-xs">
            ⚠️ วันที่เลือกย้อนไกลกว่าข้อมูลที่ดึงมาได้สำหรับบางเพจ (Pancake ให้ดึงได้แค่ &ldquo;บทสนทนาล่าสุด&rdquo; ไม่ใช่ตามช่วงวันที่)
            ตัวเลขของเพจที่ขึ้น <span className="text-amber-200 font-medium">*</span> อาจนับไม่ครบทั้งวัน
          </div>
        )}

        {/* Mobile: การ์ดแนวตั้ง ไม่ต้องเลื่อนขวา */}
        <div className="sm:hidden space-y-2">
          {pages.map((p) => (
            <div key={p.pageId} className="rounded-xl border border-gray-800 bg-gray-900/60 p-3">
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-medium leading-snug">
                  {p.name}
                  {p.coverageIncomplete && <span className="text-amber-400">*</span>}
                </p>
                <div className={`text-lg font-bold ${medianColor(p.medianMinutes)} flex-shrink-0`}>
                  {fmtMin(p.medianMinutes)}
                  <span className="text-[10px] font-normal text-gray-500 ml-1">นาที</span>
                </div>
              </div>
              {p.error ? (
                <p className="text-[11px] text-rose-400 mt-1">{p.error}</p>
              ) : (
                <div className="flex items-center gap-3 mt-1.5 text-[11px] text-gray-400">
                  <span>บทสนทนา {p.withCustomerMsg}</span>
                  <span>ไม่มีคนดู {p.noStaffSeenYet}</span>
                  <span>avg {fmtMin(p.avgMinutes)} นาที</span>
                </div>
              )}
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
                <th className="text-right py-2.5 px-3 font-medium">บทสนทนา</th>
                <th className="text-right py-2.5 px-3 font-medium">ยังไม่มีคนดู</th>
                <th className="text-right py-2.5 px-3 font-medium">median (นาที)</th>
                <th className="text-right py-2.5 px-3 font-medium">avg (นาที)</th>
              </tr>
            </thead>
            <tbody>
              {pages.map((p) => (
                <tr key={p.pageId} className="border-b border-gray-800/50 hover:bg-gray-900/50">
                  <td className="py-2 px-3">
                    {p.name}
                    {p.coverageIncomplete && <span className="text-amber-400">*</span>}
                    {p.error && <span className="ml-2 text-[10px] text-rose-400">({p.error})</span>}
                  </td>
                  <td className="py-2 px-3 text-right text-gray-300">{p.withCustomerMsg}</td>
                  <td className="py-2 px-3 text-right text-gray-300">{p.noStaffSeenYet}</td>
                  <td className={`py-2 px-3 text-right font-semibold ${medianColor(p.medianMinutes)}`}>
                    {fmtMin(p.medianMinutes)}
                  </td>
                  <td className="py-2 px-3 text-right text-gray-300">{fmtMin(p.avgMinutes)}</td>
                </tr>
              ))}
              {!loading && pages.length === 0 && !error && (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-gray-500">
                    ไม่มีข้อมูล
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
