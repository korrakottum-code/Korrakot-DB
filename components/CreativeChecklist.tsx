"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  CheckCircle2,
  XCircle,
  ClipboardList,
  RefreshCw,
  UploadCloud,
  Loader2,
} from "lucide-react";
import LogoutButton from "@/components/LogoutButton";
import { scoreChecklist, manualCheckItems, type ChecklistConfig, type MediaType } from "@/lib/creative-checklist";

interface AnalyzeReason {
  id: string;
  met: boolean;
  reason: string;
}

const MAX_UPLOAD_DIMENSION = 1280;
const RESIZE_BYTES_THRESHOLD = 1.5 * 1024 * 1024;

/**
 * ย่อรูปฝั่ง browser ก่อนอัปโหลด — ลดเวลาอัปโหลดและเวลาวิเคราะห์ของ AI ลงหลายเท่า
 * ถ้ารูปเล็กอยู่แล้ว หรือย่อไม่สำเร็จ จะส่งไฟล์เดิมแทน
 */
async function downscaleForUpload(file: File): Promise<File> {
  try {
    const bitmap = await createImageBitmap(file);
    const maxSide = Math.max(bitmap.width, bitmap.height);
    if (maxSide <= MAX_UPLOAD_DIMENSION && file.size <= RESIZE_BYTES_THRESHOLD) {
      bitmap.close();
      return file;
    }
    const scale = Math.min(1, MAX_UPLOAD_DIMENSION / maxSide);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bitmap.close();
      return file;
    }
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
    if (!blob || blob.size >= file.size) return file;
    const newName = file.name.replace(/\.(png|webp|jpeg|jpg)$/i, "") + ".jpg";
    return new File([blob], newName, { type: "image/jpeg" });
  } catch {
    return file;
  }
}

export default function CreativeChecklist() {
  const [config, setConfig] = useState<ChecklistConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [manualChecked, setManualChecked] = useState<Set<string>>(new Set());
  const [reasons, setReasons] = useState<Record<string, AnalyzeReason>>({});
  const [mediaType, setMediaType] = useState<MediaType>("image");
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string>("");
  const [dragActive, setDragActive] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState("");
  const [hasAnalyzed, setHasAnalyzed] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleItem = (id: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const pickFile = (picked: File | null) => {
    setAnalyzeError("");
    setHasAnalyzed(false);
    setChecked(new Set());
    setManualChecked(new Set());
    setReasons({});
    setFile(picked);
    setPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return picked ? URL.createObjectURL(picked) : "";
    });
  };

  const resetForm = () => {
    pickFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const analyze = useCallback(async () => {
    if (!file) return;
    setAnalyzing(true);
    setAnalyzeError("");
    try {
      const upload = await downscaleForUpload(file);
      const form = new FormData();
      form.append("image", upload);
      form.append("mediaType", mediaType);
      const res = await fetch("/api/creative-checklist/analyze", { method: "POST", body: form });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setChecked(new Set<string>(data.checkedIds || []));
      setReasons((data.reasons || {}) as Record<string, AnalyzeReason>);
      setHasAnalyzed(true);
    } catch (e: unknown) {
      setAnalyzeError(e instanceof Error ? e.message : "วิเคราะห์ภาพไม่สำเร็จ");
    } finally {
      setAnalyzing(false);
    }
  }, [file, mediaType]);

  // Auto-analyze as soon as a file is selected — no manual ticking needed.
  useEffect(() => {
    if (file && !hasAnalyzed && !analyzing) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      analyze();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file]);

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragActive(false);
    const dropped = e.dataTransfer.files?.[0];
    if (dropped) pickFile(dropped);
  };

  const result = useMemo(() => {
    if (!config) return null;
    return scoreChecklist(config, checked, mediaType);
  }, [config, checked, mediaType]);

  // ข้อที่ AI ตรวจจากภาพนิ่งไม่ได้ — ให้ user ติ๊กยืนยันเอง ไม่นับคะแนน
  const manualItems = useMemo(() => {
    if (!config) return [];
    return manualCheckItems(config, mediaType);
  }, [config, mediaType]);

  const toggleManualItem = (id: string) => {
    setManualChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

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

        {/* Media type toggle */}
        <div className="flex items-center gap-2 mb-3 print:hidden">
          <span className="text-xs text-gray-500">ประเภทคอนเทนท์:</span>
          <button
            onClick={() => setMediaType("image")}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              mediaType === "image" ? "bg-indigo-600 text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"
            }`}
          >
            ภาพนิ่ง
          </button>
          <button
            onClick={() => setMediaType("video")}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              mediaType === "video" ? "bg-indigo-600 text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"
            }`}
            title="อัปโหลดเฟรมภาพตัวแทนจากวิดีโอ"
          >
            เฟรมจากวิดีโอ
          </button>
        </div>

        {/* Upload zone */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragActive(true);
          }}
          onDragLeave={() => setDragActive(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`print:hidden mb-4 rounded-2xl border-2 border-dashed p-6 text-center cursor-pointer transition-colors ${
            dragActive ? "border-indigo-500 bg-indigo-950/30" : "border-gray-800 bg-gray-900 hover:border-gray-700"
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={(e) => pickFile(e.target.files?.[0] || null)}
          />
          {previewUrl ? (
            <div className="flex flex-col items-center gap-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={previewUrl} alt="ตัวอย่างคอนเทนท์" className="max-h-64 rounded-lg object-contain" />
              <p className="text-xs text-gray-500">{file?.name}</p>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  resetForm();
                }}
                className="text-xs text-gray-400 hover:text-gray-200 underline"
              >
                เปลี่ยนภาพ
              </button>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2 text-gray-500">
              <UploadCloud className="w-8 h-8" />
              <p className="text-sm">ลากภาพมาวางที่นี่ หรือคลิกเพื่อเลือกไฟล์</p>
              <p className="text-xs text-gray-600">รองรับ JPG, PNG, WEBP ขนาดไม่เกิน 8MB</p>
            </div>
          )}
        </div>

        {analyzing && (
          <div className="flex items-center gap-2 justify-center text-sm text-indigo-300 mb-4 print:hidden">
            <Loader2 className="w-4 h-4 animate-spin" />
            AI กำลังวิเคราะห์ภาพเทียบกับ checklist...
          </div>
        )}
        {analyzeError && (
          <div className="bg-red-950/40 border border-red-800/50 rounded-xl p-3 mb-4 text-sm text-red-300 print:hidden flex items-center justify-between gap-2">
            <span>{analyzeError}</span>
            <button onClick={analyze} className="text-xs underline flex-shrink-0">
              ลองใหม่
            </button>
          </div>
        )}

        {/* Score summary */}
        {result && hasAnalyzed && (
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
                    คะแนน {result.checkedWeight}/{result.totalWeight} ({result.percent}%) · เกณฑ์ผ่านคือ {result.threshold}%
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

        {/* ข้อที่ต้องตรวจเองด้วยตา — AI ตัดสินจากภาพนิ่งไม่ได้ ไม่นับคะแนน */}
        {hasAnalyzed && manualItems.length > 0 && (
          <div className="bg-amber-950/30 border border-amber-800/50 rounded-2xl p-4 mb-4">
            <h2 className="text-sm font-bold text-amber-300 mb-1">ตรวจเองก่อนขึ้นแอด (AI ดูจากภาพนิ่งไม่ได้)</h2>
            <p className="text-xs text-amber-200/60 mb-3">
              ข้อเหล่านี้ต้องเปิดวิดีโอจริงดู — ไม่ถูกนับในคะแนนอัตโนมัติ กรุณาติ๊กยืนยันด้วยตัวเอง
            </p>
            <div className="space-y-2">
              {manualItems.map(({ categoryLabel, item }) => (
                <label key={item.id} className="flex items-start gap-3 cursor-pointer rounded-lg p-2 hover:bg-amber-900/20">
                  <input
                    type="checkbox"
                    checked={manualChecked.has(item.id)}
                    onChange={() => toggleManualItem(item.id)}
                    className="mt-0.5 w-4 h-4 accent-amber-500"
                  />
                  <span className="text-sm text-amber-100/90 flex-1">
                    <span className="text-amber-500/70 text-xs">[{categoryLabel}]</span> {item.label}
                  </span>
                </label>
              ))}
            </div>
          </div>
        )}

        {/* Checklist categories */}
        {hasAnalyzed && (
          <div className="space-y-4">
            {config.categories.map((category) => (
              <div key={category.id} className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
                <h2 className="text-sm font-bold text-gray-200 mb-3">{category.label}</h2>
                <div className="space-y-2">
                  {category.items.filter((item) => !item.requiresVideoPlayback).map((item) => {
                    const applicable = !item.appliesTo || item.appliesTo === "both" || item.appliesTo === mediaType;
                    const reason = reasons[item.id]?.reason;
                    return (
                      <div
                        key={item.id}
                        className={`rounded-lg p-2 ${applicable ? "hover:bg-gray-800/50" : "opacity-40"}`}
                      >
                        <label className={`flex items-start gap-3 ${applicable ? "cursor-pointer" : "cursor-not-allowed"}`}>
                          <input
                            type="checkbox"
                            checked={checked.has(item.id)}
                            disabled={!applicable}
                            onChange={() => toggleItem(item.id)}
                            className="mt-0.5 w-4 h-4 accent-indigo-500"
                          />
                          <span className="text-sm text-gray-300 flex-1">{item.label}</span>
                          <span className="text-[10px] text-gray-600 flex-shrink-0">น้ำหนัก {item.weight}</span>
                        </label>
                        {!applicable && (
                          <p className="text-[11px] text-gray-600 ml-7 mt-0.5">ไม่นับคะแนนสำหรับสื่อประเภทนี้</p>
                        )}
                        {applicable && reason && (
                          <p className="text-[11px] text-gray-500 ml-7 mt-0.5 italic">AI: {reason}</p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}

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
