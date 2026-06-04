"use client";

import { useState, useRef, useEffect } from "react";
import { ChevronLeft, ChevronRight, Calendar } from "lucide-react";

interface DateRangePickerProps {
  since: string;
  until: string;
  onApply: (since: string, until: string) => void;
}

const DAYS_TH = ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"];
const MONTHS_TH = [
  "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
  "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม",
];

function fmtDate(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function fmtDisplay(dateStr: string) {
  if (!dateStr) return "เลือกวันที่";
  const d = new Date(dateStr + "T00:00:00");
  return `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`;
}

function sub(days: number) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d;
}

function startOfWeek(d: Date) {
  const r = new Date(d);
  r.setDate(r.getDate() - ((r.getDay() + 6) % 7));
  return r;
}

function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function endOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}

export default function DateRangePicker({ since, until, onApply }: DateRangePickerProps) {
  const [open, setOpen] = useState(false);
  const [tempSince, setTempSince] = useState(since);
  const [tempUntil, setTempUntil] = useState(until);
  const [selecting, setSelecting] = useState<"since" | "until">("since");
  const [viewMonth, setViewMonth] = useState(new Date().getMonth());
  const [viewYear, setViewYear] = useState(new Date().getFullYear());
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  // Sync when props change
  useEffect(() => {
    setTempSince(since);
    setTempUntil(until);
  }, [since, until]);

  const today = new Date();
  const todayStr = fmtDate(today);

  const quickPresets = [
    { label: "วันนี้", since: todayStr, until: todayStr },
    { label: "เมื่อวาน", since: fmtDate(sub(1)), until: fmtDate(sub(1)) },
    { label: "สัปดาห์นี้", since: fmtDate(startOfWeek(today)), until: todayStr },
    { label: "สัปดาห์ที่แล้ว", since: fmtDate(startOfWeek(sub(7))), until: fmtDate(sub(((today.getDay() + 6) % 7) + 1)) },
    { label: "เดือนนี้", since: fmtDate(startOfMonth(today)), until: todayStr },
    { label: "เดือนที่แล้ว", since: fmtDate(startOfMonth(new Date(today.getFullYear(), today.getMonth() - 1))), until: fmtDate(endOfMonth(new Date(today.getFullYear(), today.getMonth() - 1))) },
    { label: "7 วัน", since: fmtDate(sub(6)), until: todayStr },
    { label: "14 วัน", since: fmtDate(sub(13)), until: todayStr },
    { label: "30 วัน", since: fmtDate(sub(29)), until: todayStr },
    { label: "3 เดือน", since: fmtDate(sub(89)), until: todayStr },
  ];

  // Calendar grid
  const firstDay = new Date(viewYear, viewMonth, 1);
  const lastDay = new Date(viewYear, viewMonth + 1, 0);
  const startPad = (firstDay.getDay() + 6) % 7; // Monday = 0
  const totalDays = lastDay.getDate();

  const days: (number | null)[] = [];
  for (let i = 0; i < startPad; i++) days.push(null);
  for (let i = 1; i <= totalDays; i++) days.push(i);
  // Pad end to fill last row
  while (days.length % 7 !== 0) days.push(null);

  function handleDayClick(day: number) {
    const dateStr = fmtDate(new Date(viewYear, viewMonth, day));
    if (selecting === "since") {
      setTempSince(dateStr);
      if (tempUntil && dateStr > tempUntil) {
        setTempUntil("");
      }
      setSelecting("until");
    } else {
      if (dateStr < tempSince) {
        // If clicked before since, swap
        setTempSince(dateStr);
        setTempUntil(tempSince);
      } else {
        setTempUntil(dateStr);
      }
      setSelecting("since");
    }
  }

  function isInRange(day: number) {
    if (!tempSince || !tempUntil) return false;
    const dateStr = fmtDate(new Date(viewYear, viewMonth, day));
    return dateStr >= tempSince && dateStr <= tempUntil;
  }

  function isStart(day: number) {
    return fmtDate(new Date(viewYear, viewMonth, day)) === tempSince;
  }

  function isEnd(day: number) {
    return fmtDate(new Date(viewYear, viewMonth, day)) === tempUntil;
  }

  function isToday(day: number) {
    return fmtDate(new Date(viewYear, viewMonth, day)) === todayStr;
  }

  function handleApply() {
    if (tempSince && tempUntil) {
      onApply(tempSince, tempUntil);
      setOpen(false);
    }
  }

  function handleClear() {
    setTempSince("");
    setTempUntil("");
    setSelecting("since");
  }

  function handlePreset(p: { since: string; until: string }) {
    setTempSince(p.since);
    setTempUntil(p.until);
    // Navigate calendar to the since month
    const d = new Date(p.since + "T00:00:00");
    setViewMonth(d.getMonth());
    setViewYear(d.getFullYear());
  }

  function prevMonth() {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(viewYear - 1); }
    else setViewMonth(viewMonth - 1);
  }

  function nextMonth() {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(viewYear + 1); }
    else setViewMonth(viewMonth + 1);
  }

  const activePreset = quickPresets.find((p) => p.since === tempSince && p.until === tempUntil);

  return (
    <div ref={ref} className="relative">
      {/* Trigger button */}
      <button
        onClick={() => setOpen(!open)}
        className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium transition-all border ${
          open || since
            ? "bg-indigo-600/20 text-indigo-300 border-indigo-500/50"
            : "bg-gray-800 text-gray-300 border-gray-700 hover:bg-gray-700 hover:text-white"
        }`}
      >
        <Calendar className="w-3.5 h-3.5" />
        {since && until ? (
          <span>{fmtDisplay(since)} — {fmtDisplay(until)}</span>
        ) : (
          <span>กำหนดเอง</span>
        )}
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute right-0 top-full mt-2 z-50 bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl shadow-black/50 flex overflow-hidden" style={{ minWidth: 560 }}>
          {/* Left sidebar — presets */}
          <div className="w-[150px] border-r border-gray-700/50 py-3 flex flex-col gap-0.5 bg-gray-900/80">
            <p className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold px-3 mb-1">ช่วงเวลา</p>
            {quickPresets.map((p) => (
              <button
                key={p.label}
                onClick={() => handlePreset(p)}
                className={`text-left px-3 py-1.5 text-xs transition-colors ${
                  activePreset?.label === p.label
                    ? "bg-indigo-600/20 text-indigo-300 font-medium"
                    : "text-gray-400 hover:text-white hover:bg-gray-800"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>

          {/* Right side — calendar */}
          <div className="flex-1 p-4 flex flex-col">
            {/* Header with date display */}
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => { setSelecting("since"); }}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                    selecting === "since"
                      ? "border-indigo-500 bg-indigo-600/20 text-indigo-300"
                      : "border-gray-700 bg-gray-800 text-gray-300"
                  }`}
                >
                  📅 {tempSince ? fmtDisplay(tempSince) : "เริ่มต้น"}
                </button>
                <span className="text-gray-500 text-xs">→</span>
                <button
                  onClick={() => { setSelecting("until"); }}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                    selecting === "until"
                      ? "border-indigo-500 bg-indigo-600/20 text-indigo-300"
                      : "border-gray-700 bg-gray-800 text-gray-300"
                  }`}
                >
                  📅 {tempUntil ? fmtDisplay(tempUntil) : "สิ้นสุด"}
                </button>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={handleClear}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium text-gray-400 hover:text-white hover:bg-gray-800 border border-gray-700 transition-colors"
                >
                  ล้าง
                </button>
                <button
                  onClick={handleApply}
                  disabled={!tempSince || !tempUntil}
                  className="px-4 py-1.5 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors shadow-sm"
                >
                  Apply
                </button>
              </div>
            </div>

            {/* Month navigation */}
            <div className="flex items-center justify-between mb-3">
              <button onClick={prevMonth} className="p-1.5 rounded-lg hover:bg-gray-800 text-gray-400 hover:text-white transition-colors">
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="text-sm font-semibold text-white">
                {MONTHS_TH[viewMonth]} {viewYear + 543}
              </span>
              <button onClick={nextMonth} className="p-1.5 rounded-lg hover:bg-gray-800 text-gray-400 hover:text-white transition-colors">
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>

            {/* Day headers */}
            <div className="grid grid-cols-7 gap-0 mb-1">
              {DAYS_TH.map((d) => (
                <div key={d} className="text-center text-[10px] font-semibold text-gray-500 py-1">
                  {d}
                </div>
              ))}
            </div>

            {/* Calendar grid */}
            <div className="grid grid-cols-7 gap-0">
              {days.map((day, i) => {
                if (day === null) {
                  return <div key={`empty-${i}`} className="h-9" />;
                }

                const inRange = isInRange(day);
                const start = isStart(day);
                const end = isEnd(day);
                const todayMark = isToday(day);
                const isSingle = start && end;

                return (
                  <div key={day} className="relative flex items-center justify-center h-9">
                    {/* Range background */}
                    {inRange && !isSingle && (
                      <div
                        className={`absolute inset-y-0.5 bg-indigo-600/15 ${
                          start ? "left-1/2 right-0 rounded-l-full" : end ? "left-0 right-1/2 rounded-r-full" : "left-0 right-0"
                        }`}
                      />
                    )}
                    <button
                      onClick={() => handleDayClick(day)}
                      className={`relative z-10 w-8 h-8 rounded-full text-xs font-medium transition-all ${
                        start || end
                          ? "bg-indigo-600 text-white shadow-md shadow-indigo-500/30"
                          : todayMark
                          ? "text-indigo-400 font-bold ring-1 ring-indigo-500/50 hover:bg-indigo-600/20"
                          : inRange
                          ? "text-indigo-200 hover:bg-indigo-600/30"
                          : "text-gray-300 hover:bg-gray-800 hover:text-white"
                      }`}
                    >
                      {day}
                    </button>
                  </div>
                );
              })}
            </div>

            {/* Range info */}
            {tempSince && tempUntil && (
              <p className="text-[10px] text-gray-500 text-center mt-3">
                {Math.round((new Date(tempUntil).getTime() - new Date(tempSince).getTime()) / (1000 * 60 * 60 * 24)) + 1} วัน
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
