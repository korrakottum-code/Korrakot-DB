"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import { ArrowLeft, CheckCircle2, XCircle, ClipboardList, RefreshCw } from "lucide-react";
import LogoutButton from "@/components/LogoutButton";
import { scoreChecklist, type ChecklistConfig } from "@/lib/creative-checklist";

export default function CreativeChecklist() {
  const [config, setConfig] = useState<ChecklistConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [creativeCode, setCreativeCode] = useState("");
  const [reviewer, setReviewer] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/creative-checklist");
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setConfig(data as ChecklistConfig);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "โหลด checklist ไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Initial data fetch updates the view after mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const toggleItem = (id: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const resetForm = () => {
    setChecked(new Set());
    setCreativeCode("");
    setReviewer("");
  };

  const result = useMemo(() => {
    if (!config) return null;
    return scoreChecklist(config, checked);
  }, [config, checked]);

  const handlePrint = () => window.print();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-950 text-gray-400">
        กำลังโหลด checklist...
      </div>
    );
  }

  if (error || !config) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-950 text-red-400">
        {error || "ไม่พบข้อมูล checklist"}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <div className="max-w-4xl mx-auto p-4 sm:p-6">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4 print:hidden">
          <div className="flex items-center gap-3">
            <Link href="/" className="p-2 hover:bg-gray-800 rounded-lg transition-colors">
              <ArrowLeft className="w-5 h-5 text-gray-400" />
            </Link>
            <div>
              <h1 className="text-lg sm:text-xl font-bold flex items-center gap-2">
                <ClipboardList className="w-5 h-5 text-indigo-400" />
                ตรวจสอบคอนเทนท์ก่อนขึ้นแอด
              </h1>
              <p className="text-xs text-gray-500">
                Checklist v{config.version} · อัปเดตล่าสุด {config.lastUpdated}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={load}
              className="flex items-center gap-2 px-3 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-sm text-gray-300 transition-colors"
              title="โหลด checklist เวอร์ชันล่าสุด"
            >
              <RefreshCw className="w-4 h-4" />
              รีเฟรช
            </button>
            <LogoutButton />
          </div>
        </div>

        {/* Source note */}
        <div className="bg-indigo-950/40 border border-indigo-800/40 rounded-xl p-3 mb-4 text-xs text-indigo-200 print:hidden">
          {config.sourceNote}
        </div>

        {/* Creative meta */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
          <div>
            <label className="text-xs text-gray-500 mb-1 block">รหัสครีเอทีฟ (AW Code) เช่น PB03-0322</label>
            <input
              value={creativeCode}
              onChange={(e) => setCreativeCode(e.target.value)}
              placeholder="PB03-0322"
              className="w-full bg-gray-900 border border-gray-800 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-indigo-500"
            />
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block">ผู้ตรวจ</label>
            <input
              value={reviewer}
              onChange={(e) => setReviewer(e.target.value)}
              placeholder="ชื่อผู้ตรวจ"
              className="w-full bg-gray-900 border border-gray-800 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500"
            />
          </div>
        </div>

        {/* Score summary */}
        {result && (
          <div
            className={`rounded-2xl p-4 mb-4 border ${
              result.passed ? "bg-emerald-950/40 border-emerald-700/50" : "bg-red-950/30 border-red-800/50"
            }`}
          >
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2">
                {result.passed ? (
                  <CheckCircle2 className="w-6 h-6 text-emerald-400" />
                ) : (
                  <XCircle className="w-6 h-6 text-red-400" />
                )}
                <div>
                  <p className={`text-lg font-bold ${result.passed ? "text-emerald-300" : "text-red-300"}`}>
                    {result.passed ? "ผ่าน — พร้อมขึ้นแอด" : "ยังไม่ผ่าน — ต้องแก้ไขก่อน"}
                  </p>
                  <p className="text-xs text-gray-400">
                    คะแนน {result.checkedWeight}/{result.totalWeight} ({result.percent}%) · เกณฑ์ผ่านคือ {config.passThreshold}%
                  </p>
                </div>
              </div>
              <button
                onClick={handlePrint}
                className="print:hidden px-3 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-xs text-gray-300 transition-colors"
              >
                พิมพ์ผลสรุป
              </button>
            </div>
            {!result.passed && result.missingItems.length > 0 && (
              <div className="mt-3 pt-3 border-t border-gray-800/60">
                <p className="text-xs text-gray-400 mb-1.5">รายการที่ยังขาด ต้องแก้ก่อนขึ้นแอด:</p>
                <ul className="space-y-1">
                  {result.missingItems.map(({ categoryLabel, item }) => (
                    <li key={item.id} className="text-xs text-red-300">
                      <span className="text-gray-500">[{categoryLabel}]</span> {item.label}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {/* Checklist categories */}
        <div className="space-y-4">
          {config.categories.map((category) => (
            <div key={category.id} className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
              <h2 className="text-sm font-bold text-gray-200 mb-3">{category.label}</h2>
              <div className="space-y-2">
                {category.items.map((item) => (
                  <label
                    key={item.id}
                    className="flex items-start gap-3 p-2 rounded-lg hover:bg-gray-800/50 cursor-pointer transition-colors"
                  >
                    <input
                      type="checkbox"
                      checked={checked.has(item.id)}
                      onChange={() => toggleItem(item.id)}
                      className="mt-0.5 w-4 h-4 accent-indigo-500"
                    />
                    <span className="text-sm text-gray-300 flex-1">{item.label}</span>
                    <span className="text-[10px] text-gray-600 flex-shrink-0">น้ำหนัก {item.weight}</span>
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="flex justify-end mt-4 print:hidden">
          <button
            onClick={resetForm}
            className="px-3 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-xs text-gray-300 transition-colors"
          >
            ล้างฟอร์ม / ตรวจชิ้นใหม่
          </button>
        </div>
      </div>
    </div>
  );
}
