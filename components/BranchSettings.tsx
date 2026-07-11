"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Plus,
  Pencil,
  Trash2,
  Save,
  X,
  Search,
  ArrowLeft,
  FlaskConical,
  CheckCircle2,
  RefreshCw,
  Settings2,
  Lock,
} from "lucide-react";
import Link from "next/link";

interface BranchEntry {
  name: string;
  isTest: boolean;
}

type BranchMap = Record<string, BranchEntry>;

export default function BranchSettings() {
  const [branches, setBranches] = useState<BranchMap>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [search, setSearch] = useState("");
  // Branch configuration is managed through reviewed Pull Requests.
  const readOnly = true;

  // New branch form
  const [newCode, setNewCode] = useState("");
  const [newName, setNewName] = useState("");
  const [showAddForm, setShowAddForm] = useState(false);

  // Editing
  const [editingCode, setEditingCode] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/branches");
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setBranches(data.branches || {});
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "โหลดข้อมูลไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const showSuccess = (msg: string) => {
    setSuccess(msg);
    setTimeout(() => setSuccess(""), 3000);
  };

  const handleAdd = async () => {
    if (!newCode.trim() || !newName.trim()) {
      setError("กรุณากรอกรหัสและชื่อสาขา");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/branches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: newCode.trim(), name: newName.trim(), isTest: false }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setBranches(data.branches);
      setNewCode("");
      setNewName("");
      setShowAddForm(false);
      showSuccess(`เพิ่มสาขา ${newCode.toUpperCase().trim()} สำเร็จ`);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "เพิ่มไม่สำเร็จ");
    } finally {
      setSaving(false);
    }
  };

  const handleUpdate = async (code: string, name: string, isTest?: boolean) => {
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/branches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, name, isTest }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setBranches(data.branches);
      setEditingCode(null);
      showSuccess(`อัปเดตสาขา ${code} สำเร็จ`);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "อัปเดตไม่สำเร็จ");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (code: string) => {
    if (!confirm(`ลบสาขา ${code} (${branches[code]?.name})?`)) return;
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`/api/branches?code=${code}`, { method: "DELETE" });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setBranches(data.branches);
      showSuccess(`ลบสาขา ${code} สำเร็จ`);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "ลบไม่สำเร็จ");
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (code: string) => {
    setEditingCode(code);
    setEditName(branches[code]?.name || "");
  };

  const cancelEdit = () => {
    setEditingCode(null);
    setEditName("");
  };

  // Filter and sort
  const sortedEntries = Object.entries(branches)
    .filter(([code, entry]) => {
      if (!search.trim()) return true;
      const q = search.toLowerCase().trim();
      return code.toLowerCase().includes(q) || entry.name.toLowerCase().includes(q);
    })
    .sort((a, b) => {
      // Test branches at the bottom, then alphabetical
      if (a[1].isTest !== b[1].isTest) return a[1].isTest ? 1 : -1;
      return a[0].localeCompare(b[0]);
    });

  const testCount = Object.values(branches).filter((b) => b.isTest).length;
  const activeCount = Object.values(branches).length - testCount;

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* Header */}
      <div className="border-b border-gray-800 bg-gray-900 px-4 sm:px-6 py-3 sm:py-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm text-gray-400 hover:text-white hover:bg-gray-800 transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              <span className="hidden sm:inline">Dashboard</span>
            </Link>
            <div>
              <div className="flex items-center gap-2">
                <Settings2 className="w-5 h-5 text-indigo-400" />
                <h1 className="text-xl font-bold text-white">ตั้งค่าสาขา</h1>
              </div>
              <p className="text-xs text-gray-400 mt-0.5">
                จัดการรหัสย่อ, ชื่อสาขา และสถานะเทส
              </p>
            </div>
          </div>
          <button
            onClick={load}
            disabled={loading}
            className="flex items-center gap-2 px-3 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-sm text-gray-300 transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            รีเฟรช
          </button>
        </div>
      </div>

      <div className="p-4 sm:p-6 max-w-4xl mx-auto space-y-6">
        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
            <p className="text-xs text-slate-400">สาขาทั้งหมด</p>
            <p className="text-2xl font-bold text-white mt-1">{Object.keys(branches).length}</p>
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
            <div className="flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
              <p className="text-xs text-slate-400">Active</p>
            </div>
            <p className="text-2xl font-bold text-emerald-400 mt-1">{activeCount}</p>
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
            <div className="flex items-center gap-1.5">
              <FlaskConical className="w-3.5 h-3.5 text-amber-400" />
              <p className="text-xs text-slate-400">สาขาเทส</p>
            </div>
            <p className="text-2xl font-bold text-amber-400 mt-1">{testCount}</p>
          </div>
        </div>

        {/* Alerts */}
        {error && (
          <div className="bg-red-900/40 border border-red-700 rounded-lg px-4 py-3 text-red-300 text-sm flex items-center justify-between">
            <span>❌ {error}</span>
            <button onClick={() => setError("")} className="text-red-400 hover:text-red-300">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
        {success && (
          <div className="bg-emerald-900/40 border border-emerald-700 rounded-lg px-4 py-3 text-emerald-300 text-sm flex items-center gap-2 animate-fade-in">
            <CheckCircle2 className="w-4 h-4" />
            {success}
          </div>
        )}

        {/* Read-only banner */}
        <div className="bg-slate-800/60 border border-slate-700 rounded-xl p-4 flex items-start gap-3">
            <Lock className="w-5 h-5 text-slate-400 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-sm font-medium text-slate-200">โหมดอ่านอย่างเดียว</p>
              <p className="text-xs text-slate-400 mt-1">
                การแก้ไขสาขาต้องทำผ่าน Pull Request โดยแก้ไฟล์ <code className="bg-slate-700 px-1.5 py-0.5 rounded text-slate-300">data/branch-config.json</code> แล้ว deploy ใหม่
              </p>
            </div>
        </div>

        {/* Search + Add button */}
        <div className="flex items-center gap-3">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-gray-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="ค้นหาสาขา..."
              className="w-full bg-gray-900 border border-gray-700 rounded-lg pl-10 pr-4 py-2.5 text-sm text-white placeholder:text-gray-500 focus:outline-none focus:border-indigo-500 transition-colors"
            />
          </div>
          {!readOnly && (
            <button
              onClick={() => setShowAddForm(!showAddForm)}
              className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap bg-indigo-600 hover:bg-indigo-500"
            >
              <Plus className="w-4 h-4" />
              เพิ่มสาขา
            </button>
          )}
        </div>

        {/* Add form */}
        {!readOnly && showAddForm && (
          <div className="bg-indigo-950/30 border border-indigo-800/50 rounded-xl p-4 space-y-3 animate-fade-in">
            <p className="text-sm font-medium text-indigo-300">เพิ่มสาขาใหม่</p>
            <div className="flex flex-col sm:flex-row gap-3">
              <input
                value={newCode}
                onChange={(e) => setNewCode(e.target.value.toUpperCase())}
                placeholder="รหัสย่อ เช่น BKK"
                className="flex-1 bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder:text-gray-500 focus:outline-none focus:border-indigo-500 font-mono"
                maxLength={10}
              />
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="ชื่อสาขา เช่น กรุงเทพ"
                className="flex-1 bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder:text-gray-500 focus:outline-none focus:border-indigo-500"
              />
              <div className="flex gap-2">
                <button
                  onClick={handleAdd}
                  disabled={saving || !newCode.trim() || !newName.trim()}
                  className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded-lg text-sm font-medium transition-colors"
                >
                  <Save className="w-4 h-4" />
                  บันทึก
                </button>
                <button
                  onClick={() => { setShowAddForm(false); setNewCode(""); setNewName(""); }}
                  className="px-3 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-sm text-gray-300 transition-colors"
                >
                  ยกเลิก
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Branch Table */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center h-40 text-gray-400">
              <RefreshCw className="w-5 h-5 animate-spin mr-2" />
              กำลังโหลด...
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-800">
                    <th className="text-left py-3 px-4 text-gray-400 font-medium text-xs uppercase tracking-wider">รหัส</th>
                    <th className="text-left py-3 px-4 text-gray-400 font-medium text-xs uppercase tracking-wider">ชื่อสาขา</th>
                    <th className="text-center py-3 px-4 text-gray-400 font-medium text-xs uppercase tracking-wider">สถานะ</th>
                    <th className="text-right py-3 px-4 text-gray-400 font-medium text-xs uppercase tracking-wider">จัดการ</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedEntries.map(([code, entry]) => (
                    <tr
                      key={code}
                      className={`border-b border-gray-800/50 hover:bg-gray-800/50 transition-colors ${
                        entry.isTest ? "bg-amber-950/10" : ""
                      }`}
                    >
                      <td className="py-3 px-4">
                        <span className="font-mono text-indigo-300 font-semibold text-sm">{code}</span>
                      </td>
                      <td className="py-3 px-4">
                        {editingCode === code && !readOnly ? (
                          <div className="flex items-center gap-2">
                            <input
                              value={editName}
                              onChange={(e) => setEditName(e.target.value)}
                              className="bg-gray-800 border border-gray-600 rounded-lg px-2 py-1.5 text-sm text-white focus:outline-none focus:border-indigo-500 w-full max-w-[200px]"
                              autoFocus
                              onKeyDown={(e) => {
                                if (e.key === "Enter") handleUpdate(code, editName, entry.isTest);
                                if (e.key === "Escape") cancelEdit();
                              }}
                            />
                            <button
                              onClick={() => handleUpdate(code, editName, entry.isTest)}
                              disabled={saving || !editName.trim()}
                              className="p-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 transition-colors"
                            >
                              <Save className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={cancelEdit}
                              className="p-1.5 rounded-lg bg-gray-700 hover:bg-gray-600 transition-colors"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ) : (
                          <span className="text-white">{entry.name}</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-center">
                        <span
                          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium ${
                            entry.isTest
                              ? "bg-amber-500/15 text-amber-300 border border-amber-500/30"
                              : "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30"
                          }`}
                        >
                          {entry.isTest ? (
                            <>
                              <FlaskConical className="w-3 h-3" />
                              เทส
                            </>
                          ) : (
                            <>
                              <CheckCircle2 className="w-3 h-3" />
                              Active
                            </>
                          )}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-1">
                          {editingCode !== code && !readOnly && (
                            <button
                              onClick={() => startEdit(code)}
                              className="p-2 rounded-lg text-gray-400 hover:text-white hover:bg-gray-800 transition-colors"
                              title="แก้ไข"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                          )}
                          {!readOnly && (
                          <button
                            onClick={() => handleDelete(code)}
                            disabled={saving}
                            className="p-2 rounded-lg text-gray-400 hover:text-red-400 hover:bg-red-900/20 transition-colors"
                            title="ลบ"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {sortedEntries.length === 0 && (
                    <tr>
                      <td colSpan={4} className="py-10 text-center text-gray-500">
                        {search ? "ไม่พบสาขาที่ค้นหา" : "ยังไม่มีสาขา"}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Info */}
        <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-4 text-xs text-slate-400 space-y-2">
          <p className="font-medium text-slate-300">💡 คำแนะนำ</p>
          <ul className="list-disc list-inside space-y-1">
            <li>สาขาที่ถูก mark เป็น <span className="text-amber-300 font-medium">&quot;เทส&quot;</span> จะถูกซ่อนจาก Dashboard โดย default</li>
            <li>รหัสย่อและชื่อสาขาจะแก้ไขผ่าน Pull Request เท่านั้น</li>
            <li>เมื่อระบบจับ branch code ใหม่ได้ จะแสดงเป็น warning บน Dashboard — จากนั้นแก้ไฟล์ config แล้ว deploy ใหม่</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
