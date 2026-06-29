"use client";

import { useState } from "react";
import { ChevronDown, X, FlaskConical } from "lucide-react";
import type { TabKey } from "./types";

interface Props {
  tab: TabKey;
  branchFilter: "all" | "class" | "classgo";
  onBranchFilter: (v: "all" | "class" | "classgo") => void;
  branchName: string;
  onBranchName: (v: string) => void;
  branchOptions: string[];
  programFilter: string;
  onProgramFilter: (v: string) => void;
  programOptions: { code: string; label: string }[];
  onClear: () => void;
  hideTest: boolean;
  onHideTest: (v: boolean) => void;
  testCount?: number;
}

function BranchDropdown({ value, options, onChange }: { value: string; options: string[]; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const label = value === "all" ? "ทุกสาขา" : value;
  const filteredOptions = options.filter((opt) => opt.toLowerCase().includes(query.trim().toLowerCase()));

  return (
    <>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="hidden sm:block bg-slate-900 border border-slate-700 text-slate-200 text-xs rounded-lg px-2 py-1.5 focus:outline-none min-w-[140px]"
      >
        <option value="all">ทุกสาขา</option>
        {options.map((b) => (
          <option key={b} value={b}>{b}</option>
        ))}
      </select>

      <div className="relative sm:hidden">
        <button
          onClick={() => setOpen(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 border border-slate-600 rounded-lg text-sm text-slate-200 min-w-[120px] justify-between"
        >
          <span className="truncate">{label}</span>
          <ChevronDown className="w-4 h-4 flex-shrink-0 text-slate-400" />
        </button>

        {open && (
          <div className="fixed inset-0 z-50 bg-slate-950 text-white flex flex-col">
            <div className="flex items-center justify-between px-4 py-4 border-b border-slate-800">
              <div>
                <p className="text-base font-bold">เลือกสาขา</p>
                <p className="text-xs text-slate-400">กำลังเลือก: {label}</p>
              </div>
              <button onClick={() => setOpen(false)} className="p-2 rounded-xl bg-slate-900 border border-slate-700">
                <X className="w-5 h-5 text-slate-300" />
              </button>
            </div>

            <div className="p-4 space-y-3 border-b border-slate-800">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="ค้นหาสาขา..."
                className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-3 text-base text-white placeholder:text-slate-500 focus:outline-none focus:border-indigo-500"
              />
              <button
                onClick={() => { onChange("all"); setOpen(false); setQuery(""); }}
                className={`w-full rounded-xl px-4 py-3 text-left text-sm font-semibold border ${
                  value === "all" ? "bg-indigo-600 border-indigo-500 text-white" : "bg-slate-900 border-slate-700 text-slate-200"
                }`}
              >
                ทุกสาขา
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              <div className="grid grid-cols-2 gap-2">
                {filteredOptions.map((opt) => (
                  <button
                    key={opt}
                    onClick={() => { onChange(opt); setOpen(false); setQuery(""); }}
                    className={`min-h-12 rounded-xl px-3 py-2 text-sm font-medium border text-left ${
                      value === opt ? "bg-indigo-600 border-indigo-500 text-white" : "bg-slate-900 border-slate-700 text-slate-200 active:bg-slate-800"
                    }`}
                  >
                    {opt}
                  </button>
                ))}
              </div>
              {filteredOptions.length === 0 && (
                <div className="py-10 text-center text-sm text-slate-500">ไม่พบสาขา</div>
              )}
            </div>

            <div className="p-4 border-t border-slate-800 bg-slate-950">
              <button
                onClick={() => setOpen(false)}
                className="w-full bg-slate-800 border border-slate-700 rounded-xl py-3 text-sm font-semibold text-slate-200"
              >
                ปิด
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

export default function FilterBar({
  tab,
  branchFilter,
  onBranchFilter,
  branchName,
  onBranchName,
  branchOptions,
  programFilter,
  onProgramFilter,
  programOptions,
  onClear,
  hideTest,
  onHideTest,
  testCount = 0,
}: Props) {
  const showBranchGroup = tab === "branch" || tab === "program" || tab === "creative";
  const showProgramButtons = tab === "branch" || tab === "creative";
  const showBranchSelect = tab === "program" || tab === "creative";

  return (
    <div className="flex flex-nowrap items-center gap-1 ml-auto text-[11px] sm:text-xs overflow-x-auto pb-1">
      {showBranchGroup && (
        <div className="flex flex-nowrap items-center gap-1 whitespace-nowrap">
          {(["all", "class", "classgo"] as const).map((f) => (
            <button
              key={f}
              onClick={() => onBranchFilter(f)}
              className={`px-2.5 py-1.5 rounded-lg font-medium transition-colors ${
                branchFilter === f ? "bg-teal-600 text-white" : "text-gray-400 hover:text-white hover:bg-gray-800"
              }`}
            >
              {f === "all" ? "ทั้งหมด" : f === "class" ? "Class" : "Class Go"}
            </button>
          ))}
          {showBranchSelect && (
            <BranchDropdown value={branchName} options={branchOptions} onChange={onBranchName} />
          )}
        </div>
      )}

      {showProgramButtons && (
        <>
          <span className="text-slate-700 mx-1">|</span>
          <button
            onClick={() => onProgramFilter("all")}
            className={`px-2.5 py-1.5 rounded-lg font-medium transition-colors ${
              programFilter === "all" ? "bg-indigo-600 text-white" : "text-slate-300 hover:text-white hover:bg-slate-800"
            }`}
          >
            ทุกโปรแกรม
          </button>
          {programOptions.map(({ code, label }) => (
            <button
              key={code}
              onClick={() => onProgramFilter(code)}
              className={`px-2.5 py-1.5 rounded-lg font-medium transition-colors ${
                programFilter === code ? "bg-indigo-600 text-white" : "text-slate-300 hover:text-white hover:bg-slate-800"
              }`}
            >
              {label}
            </button>
          ))}
        </>
      )}

      <span className="text-slate-700 mx-1">|</span>
      <button
        onClick={() => onHideTest(!hideTest)}
        className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg font-medium transition-colors ${
          hideTest ? "bg-amber-600/20 text-amber-300 border border-amber-600/30" : "text-slate-400 hover:text-white hover:bg-slate-800"
        }`}
        title={hideTest ? "กำลังซ่อนสาขาเทส" : "แสดงสาขาเทสอยู่"}
      >
        <FlaskConical className="w-3 h-3" />
        {hideTest ? `ซ่อนเทส${testCount > 0 ? ` (${testCount})` : ""}` : "แสดงเทส"}
      </button>
      <span className="text-slate-700 mx-1">|</span>
      <button
        onClick={onClear}
        className="px-2.5 py-1.5 rounded-lg font-medium transition-colors text-slate-200 bg-slate-800 hover:bg-slate-700"
      >
        ล้างตัวกรอง
      </button>
    </div>
  );
}
