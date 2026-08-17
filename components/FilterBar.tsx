"use client";

import { useState } from "react";
import { ChevronDown, X, EyeOff, Search, ArrowLeftRight } from "lucide-react";
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
  adCodeFilter: string;
  onAdCodeFilter: (v: string) => void;
  showComparison: boolean;
  onToggleComparison: (v: boolean) => void;
  onClear: () => void;
  excludedBranches: Set<string>;
  onExcludedBranches: (v: Set<string>) => void;
  allBranchNames: string[];
  promoFilter: string;
  onPromoFilter: (v: string) => void;
  promoOptions: string[];
  untaggedPromoValue: string;
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

/**
 * กรองตามกลุ่มโปรโมชั่นที่ทีมติดแท็กเองในหน้า Creative (ราคาไม่ได้อยู่ในชื่อแอด)
 * ใช้ได้ทุกแท็บของรายงาน ไม่ผูกกับ tab ใดโดยเฉพาะเหมือน branch/program filter
 */
function PromoDropdown({
  value,
  options,
  onChange,
  untaggedValue,
}: {
  value: string;
  options: string[];
  onChange: (v: string) => void;
  untaggedValue: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="bg-slate-900 border border-slate-700 text-slate-200 text-xs rounded-lg px-2 py-1.5 focus:outline-none min-w-[130px]"
    >
      <option value="all">ทุกกลุ่มโปร</option>
      {options.map((g) => (
        <option key={g} value={g}>{g}</option>
      ))}
      <option value={untaggedValue}>ยังไม่ได้ตั้งกลุ่ม</option>
    </select>
  );
}

/* ── Multi-select exclude branches popup ── */
function ExcludeBranchesPopup({
  allBranches,
  excluded,
  onChange,
}: {
  allBranches: string[];
  excluded: Set<string>;
  onChange: (v: Set<string>) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const filtered = allBranches.filter((b) => b.toLowerCase().includes(query.trim().toLowerCase()));

  const toggle = (branch: string) => {
    const next = new Set(excluded);
    if (next.has(branch)) next.delete(branch);
    else next.add(branch);
    onChange(next);
  };

  const selectAll = () => onChange(new Set());
  const excludeFiltered = () => {
    const next = new Set(excluded);
    filtered.forEach((b) => next.add(b));
    onChange(next);
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg font-medium transition-colors ${
          excluded.size > 0
            ? "bg-rose-600/20 text-rose-300 border border-rose-600/30"
            : "text-slate-400 hover:text-white hover:bg-slate-800"
        }`}
      >
        <EyeOff className="w-3 h-3" />
        {excluded.size > 0 ? `ซ่อน ${excluded.size} สาขา` : "ซ่อนสาขา"}
      </button>

      {open && (
        <>
          {/* Backdrop */}
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />

          {/* Desktop popup */}
          <div className="hidden sm:block absolute right-0 top-full mt-2 z-50 w-[320px] bg-slate-900 border border-slate-700 rounded-xl shadow-2xl shadow-black/40 overflow-hidden">
            <div className="p-3 border-b border-slate-800">
              <p className="text-sm font-semibold text-white mb-2">เลือกสาขาที่ต้องการซ่อน</p>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="ค้นหา..."
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-indigo-500"
                autoFocus
              />
              <div className="flex gap-2 mt-2">
                <button onClick={selectAll} className="text-[10px] text-indigo-400 hover:text-indigo-300">แสดงทั้งหมด</button>
                <span className="text-slate-700">|</span>
                <button onClick={excludeFiltered} className="text-[10px] text-rose-400 hover:text-rose-300">ซ่อนทั้งหมด</button>
              </div>
            </div>
            <div className="max-h-[280px] overflow-y-auto p-2">
              {filtered.map((branch) => {
                const isExcluded = excluded.has(branch);
                return (
                  <button
                    key={branch}
                    onClick={() => toggle(branch)}
                    className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-left transition-colors ${
                      isExcluded ? "text-slate-500 hover:bg-slate-800" : "text-white hover:bg-slate-800"
                    }`}
                  >
                    <div className={`w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center transition-colors ${
                      isExcluded ? "border-rose-500/50 bg-rose-500/20" : "border-slate-600 bg-slate-800"
                    }`}>
                      {isExcluded && <EyeOff className="w-2.5 h-2.5 text-rose-400" />}
                    </div>
                    <span className={isExcluded ? "line-through" : ""}>{branch}</span>
                  </button>
                );
              })}
              {filtered.length === 0 && (
                <div className="py-6 text-center text-xs text-slate-500">ไม่พบสาขา</div>
              )}
            </div>
            <div className="p-2 border-t border-slate-800">
              <button
                onClick={() => setOpen(false)}
                className="w-full bg-slate-800 hover:bg-slate-700 rounded-lg py-2 text-xs font-medium text-slate-200 transition-colors"
              >
                ปิด
              </button>
            </div>
          </div>

          {/* Mobile fullscreen */}
          <div className="sm:hidden fixed inset-0 z-50 bg-slate-950 text-white flex flex-col">
            <div className="flex items-center justify-between px-4 py-4 border-b border-slate-800">
              <div>
                <p className="text-base font-bold">ซ่อนสาขา</p>
                <p className="text-xs text-slate-400">กดเพื่อซ่อน/แสดง ({excluded.size} ซ่อนอยู่)</p>
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
              <div className="flex gap-3">
                <button onClick={selectAll} className="text-sm text-indigo-400">แสดงทั้งหมด</button>
                <button onClick={excludeFiltered} className="text-sm text-rose-400">ซ่อนทั้งหมด</button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              <div className="space-y-1">
                {filtered.map((branch) => {
                  const isExcluded = excluded.has(branch);
                  return (
                    <button
                      key={branch}
                      onClick={() => toggle(branch)}
                      className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm text-left border transition-colors ${
                        isExcluded
                          ? "text-slate-500 border-slate-800 bg-slate-900/50"
                          : "text-white border-slate-700 bg-slate-900"
                      }`}
                    >
                      <div className={`w-5 h-5 rounded border flex-shrink-0 flex items-center justify-center ${
                        isExcluded ? "border-rose-500/50 bg-rose-500/20" : "border-slate-600 bg-slate-800"
                      }`}>
                        {isExcluded && <EyeOff className="w-3 h-3 text-rose-400" />}
                      </div>
                      <span className={isExcluded ? "line-through" : ""}>{branch}</span>
                    </button>
                  );
                })}
              </div>
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
        </>
      )}
    </div>
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
  adCodeFilter,
  onAdCodeFilter,
  showComparison,
  onToggleComparison,
  onClear,
  excludedBranches,
  onExcludedBranches,
  allBranchNames,
  promoFilter,
  onPromoFilter,
  promoOptions,
  untaggedPromoValue,
}: Props) {
  const showBranchGroup = tab === "branch" || tab === "program" || tab === "creative";
  const showProgramButtons = tab === "branch" || tab === "creative";
  const showBranchSelect = tab === "program" || tab === "creative";

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm bg-slate-900/60 border border-slate-800 rounded-xl px-3 py-2.5">
      {/* Code แอด filter */}
      <div className="relative flex items-center">
        <Search className="w-3.5 h-3.5 absolute left-2.5 text-slate-400 pointer-events-none" />
        <input
          type="text"
          value={adCodeFilter}
          onChange={(e) => onAdCodeFilter(e.target.value)}
          placeholder="ค้นหา Code แอด (เช่น PB02, 0001)..."
          className="bg-slate-900 border border-slate-700 text-slate-200 text-xs rounded-lg pl-8 pr-7 py-1.5 focus:outline-none focus:border-indigo-500 min-w-[170px] sm:min-w-[210px] placeholder:text-slate-500"
        />
        {adCodeFilter && (
          <button
            onClick={() => onAdCodeFilter("")}
            className="absolute right-2 text-slate-400 hover:text-white p-0.5"
            title="ล้างคำค้นหา"
          >
            <X className="w-3 h-3" />
          </button>
        )}
      </div>

      {showBranchGroup && (
        <>
          <span className="text-slate-700 mx-0.5 hidden sm:inline">|</span>
          <div className="flex flex-wrap items-center gap-1.5">
            {(["all", "class", "classgo"] as const).map((f) => (
              <button
                key={f}
                onClick={() => onBranchFilter(f)}
                className={`px-3 py-1.5 rounded-lg font-medium transition-colors border ${
                  branchFilter === f
                    ? "bg-teal-600 text-white border-teal-500"
                    : "text-slate-300 border-slate-700 hover:text-white hover:bg-slate-800 hover:border-slate-600"
                }`}
              >
                {f === "all" ? "ทั้งหมด" : f === "class" ? "Class" : "Class Go"}
              </button>
            ))}
            {showBranchSelect && (
              <BranchDropdown value={branchName} options={branchOptions} onChange={onBranchName} />
            )}
          </div>
        </>
      )}

      {showProgramButtons && (
        <>
          <span className="text-slate-700 mx-0.5">|</span>
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              onClick={() => onProgramFilter("all")}
              className={`px-3 py-1.5 rounded-lg font-medium transition-colors border ${
                programFilter === "all"
                  ? "bg-indigo-600 text-white border-indigo-500"
                  : "text-slate-300 border-slate-700 hover:text-white hover:bg-slate-800 hover:border-slate-600"
              }`}
            >
              ทุกโปรแกรม
            </button>
            {programOptions.map(({ code, label }) => (
              <button
                key={code}
                onClick={() => onProgramFilter(code)}
                className={`px-3 py-1.5 rounded-lg font-medium transition-colors border ${
                  programFilter === code
                    ? "bg-indigo-600 text-white border-indigo-500"
                    : "text-slate-300 border-slate-700 hover:text-white hover:bg-slate-800 hover:border-slate-600"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </>
      )}

      <span className="text-slate-700 mx-0.5">|</span>
      <ExcludeBranchesPopup
        allBranches={allBranchNames}
        excluded={excludedBranches}
        onChange={onExcludedBranches}
      />

      {/* กลุ่มโปรโมชั่น (แท็กเองที่หน้า Creative) — ใช้กรองได้ทุกแท็บของรายงาน */}
      <span className="text-slate-700 mx-0.5">|</span>
      <PromoDropdown
        value={promoFilter}
        options={promoOptions}
        onChange={onPromoFilter}
        untaggedValue={untaggedPromoValue}
      />

      <span className="text-slate-700 mx-0.5">|</span>
      {/* Comparison Toggle Button */}
      <button
        onClick={() => onToggleComparison(!showComparison)}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-medium transition-colors border ${
          showComparison
            ? "bg-amber-600/20 text-amber-300 border-amber-500/50 shadow-sm shadow-amber-900/30"
            : "text-slate-300 border-slate-700 hover:text-white hover:bg-slate-800 hover:border-slate-600"
        }`}
        title="เปิด/ปิดการแสดงเปรียบเทียบกับช่วงเวลาที่แล้ว"
      >
        <ArrowLeftRight className="w-3.5 h-3.5" />
        <span>เปรียบเทียบช่วงก่อน</span>
      </button>

      <span className="text-slate-700 mx-0.5">|</span>
      <button
        onClick={onClear}
        className="px-3 py-1.5 rounded-lg font-medium transition-colors text-slate-300 border border-slate-700 bg-slate-800 hover:bg-slate-700 hover:border-slate-600"
      >
        ล้างตัวกรอง
      </button>
    </div>
  );
}

