"use client";

import { useState, useEffect, useCallback } from "react";
import { Plus, Pencil, Trash2, Save, X, CheckCircle2, Layers, Tags } from "lucide-react";

type MapKind = "program" | "sub";

interface SectionProps {
  kind: MapKind;
  title: string;
  description: string;
  codeHint: string;
  icon: React.ReactNode;
  entries: Record<string, string>;
  writable: boolean;
  onChanged: (data: { programs: Record<string, string>; subs: Record<string, string> }) => void;
}

function MapSection({ kind, title, description, codeHint, icon, entries, writable, onChanged }: SectionProps) {
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [saving, setSaving] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [newCode, setNewCode] = useState("");
  const [newName, setNewName] = useState("");
  const [editingCode, setEditingCode] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  const showSuccess = (msg: string) => {
    setSuccess(msg);
    setTimeout(() => setSuccess(""), 3000);
  };

  const save = async (code: string, name: string, isNew: boolean) => {
    if (!code.trim() || !name.trim()) {
      setError("กรุณากรอกรหัสและชื่อ");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/parser-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, code: code.trim(), name: name.trim() }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      onChanged(data);
      setEditingCode(null);
      if (isNew) {
        setNewCode("");
        setNewName("");
        setShowAdd(false);
      }
      showSuccess(`บันทึก ${code.toUpperCase().trim()} สำเร็จ`);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "บันทึกไม่สำเร็จ");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (code: string) => {
    if (!confirm(`ลบ ${code} (${entries[code]})?`)) return;
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`/api/parser-config?kind=${kind}&code=${encodeURIComponent(code)}`, { method: "DELETE" });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      onChanged(data);
      showSuccess(`ลบ ${code} สำเร็จ`);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "ลบไม่สำเร็จ");
    } finally {
      setSaving(false);
    }
  };

  const sorted = Object.entries(entries).sort((a, b) => a[0].localeCompare(b[0]));

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 sm:p-5">
      <div className="flex items-center justify-between gap-3 mb-1">
        <h2 className="text-sm font-bold text-gray-200 flex items-center gap-2">
          {icon}
          {title}
          <span className="text-xs font-normal text-gray-500">({sorted.length})</span>
        </h2>
        {writable && (
          <button
            onClick={() => setShowAdd((v) => !v)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 rounded-lg text-xs font-medium transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            เพิ่ม
          </button>
        )}
      </div>
      <p className="text-xs text-gray-500 mb-3">{description}</p>

      {error && (
        <div className="bg-red-900/40 border border-red-700 rounded-lg px-3 py-2 text-red-300 text-xs mb-3 flex items-center justify-between">
          <span>❌ {error}</span>
          <button onClick={() => setError("")} className="text-red-400 hover:text-red-300">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
      {success && (
        <div className="bg-emerald-900/40 border border-emerald-700 rounded-lg px-3 py-2 text-emerald-300 text-xs mb-3 flex items-center gap-2">
          <CheckCircle2 className="w-3.5 h-3.5" />
          {success}
        </div>
      )}

      {writable && showAdd && (
        <div className="bg-indigo-950/30 border border-indigo-800/50 rounded-xl p-3 mb-3 flex flex-col sm:flex-row gap-2">
          <input
            value={newCode}
            onChange={(e) => setNewCode(e.target.value.toUpperCase())}
            placeholder={codeHint}
            className="sm:w-36 bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder:text-gray-600 focus:outline-none focus:border-indigo-500"
          />
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="ชื่อที่จะแสดงใน dashboard"
            className="flex-1 bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder:text-gray-600 focus:outline-none focus:border-indigo-500"
          />
          <button
            onClick={() => save(newCode, newName, true)}
            disabled={saving}
            className="flex items-center justify-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 rounded-lg text-sm font-medium transition-colors"
          >
            <Save className="w-4 h-4" />
            บันทึก
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
        {sorted.map(([code, name]) => (
          <div key={code} className="flex items-center gap-2 bg-gray-800/50 hover:bg-gray-800 rounded-lg px-3 py-2">
            <code className="text-xs font-bold text-indigo-300 bg-indigo-950/60 px-1.5 py-0.5 rounded flex-shrink-0">
              {code}
            </code>
            {editingCode === code && writable ? (
              <>
                <input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="flex-1 min-w-0 bg-gray-900 border border-indigo-600 rounded px-2 py-1 text-xs text-white focus:outline-none"
                  autoFocus
                />
                <button onClick={() => save(code, editName, false)} disabled={saving} className="text-emerald-400 hover:text-emerald-300 flex-shrink-0">
                  <Save className="w-3.5 h-3.5" />
                </button>
                <button onClick={() => setEditingCode(null)} className="text-gray-500 hover:text-gray-300 flex-shrink-0">
                  <X className="w-3.5 h-3.5" />
                </button>
              </>
            ) : (
              <>
                <span className="text-xs text-gray-300 flex-1 truncate" title={name}>{name}</span>
                {writable && (
                  <>
                    <button
                      onClick={() => {
                        setEditingCode(code);
                        setEditName(name);
                      }}
                      className="text-gray-500 hover:text-indigo-300 flex-shrink-0"
                      title="แก้ไขชื่อ"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => remove(code)} className="text-gray-600 hover:text-red-400 flex-shrink-0" title="ลบ">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </>
                )}
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function ParserMapSettings() {
  const [programs, setPrograms] = useState<Record<string, string>>({});
  const [subs, setSubs] = useState<Record<string, string>>({});
  const [writable, setWritable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const res = await fetch("/api/parser-config");
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setPrograms(data.programs || {});
      setSubs(data.subs || {});
      setWritable(data.writable === true);
    } catch (e: unknown) {
      setLoadError(e instanceof Error ? e.message : "โหลดข้อมูลไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Initial data fetch updates the view after mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const onChanged = (data: { programs: Record<string, string>; subs: Record<string, string> }) => {
    setPrograms(data.programs || {});
    setSubs(data.subs || {});
  };

  if (loading) {
    return <div className="text-sm text-gray-500 text-center py-6">กำลังโหลดโปรแกรม/หมวดย่อย...</div>;
  }
  if (loadError) {
    return (
      <div className="bg-red-900/40 border border-red-700 rounded-lg px-4 py-3 text-red-300 text-sm">
        ❌ {loadError}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <MapSection
        kind="program"
        title="โปรแกรม"
        description="รหัสโปรแกรมในชื่อแอด เช่น F = ฟิลเลอร์ — ใช้จัดกลุ่มทุกหน้าใน dashboard"
        codeHint="รหัส เช่น F, ALL"
        icon={<Layers className="w-4 h-4 text-indigo-400" />}
        entries={programs}
        writable={writable}
        onChanged={onChanged}
      />
      <MapSection
        kind="sub"
        title="หมวดย่อย"
        description="รหัสหมวดย่อย = โปรแกรม+เลข 2 หลัก ตรงกับรหัสใน ad name เช่น B02 = โบท็อกซ์ กราม, ALL03 = โปรรวม ผ่อน0% (พิมพ์ B2 ระบบจะเก็บเป็น B02 ให้)"
        codeHint="รหัส เช่น B02, ALL03"
        icon={<Tags className="w-4 h-4 text-purple-400" />}
        entries={subs}
        writable={writable}
        onChanged={onChanged}
      />
    </div>
  );
}
