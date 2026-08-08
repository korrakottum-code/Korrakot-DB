import { NextRequest, NextResponse } from "next/server";
import { requireInternalApiAuth } from "@/lib/api-auth";
import { consumeApiRateLimit } from "@/lib/rate-limit";
import { isSameOriginRequest } from "@/lib/security";
import {
  isParserConfigWritable,
  readParserConfig,
  upsertParserConfig,
  deleteParserConfig,
} from "@/lib/parser-config-store";
import { readBranchConfigFile, BRANCH_MAP } from "@/lib/parser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface BranchEntry {
  name: string;
  isTest: boolean;
}

// อ่านรายการสาขาที่มีผลจริง: จาก DB เมื่อตั้งค่า POSTGRES_URL แล้ว
// ไม่งั้น fallback อ่านจากไฟล์/hardcode แบบ read-only เหมือนเดิม
async function currentBranches(): Promise<Record<string, BranchEntry>> {
  if (isParserConfigWritable()) {
    const config = await readParserConfig();
    return config.branches;
  }
  const merged: Record<string, BranchEntry> = {};
  for (const [code, name] of Object.entries(BRANCH_MAP)) merged[code] = { name, isTest: false };
  for (const [code, entry] of Object.entries(readBranchConfigFile().branches)) merged[code] = entry;
  return merged;
}

// GET /api/branches — return all branches (+ whether editing is enabled).
export async function GET(req: NextRequest) {
  const denied = requireInternalApiAuth(req);
  if (denied) return denied;

  try {
    const branches = await currentBranches();
    return NextResponse.json({ branches, writable: isParserConfigWritable() });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "อ่านข้อมูลสาขาไม่สำเร็จ" },
      { status: 500 }
    );
  }
}

function mutationDenied(req: NextRequest): NextResponse | null {
  const denied = requireInternalApiAuth(req);
  if (denied) return denied;
  if (!isSameOriginRequest(req.url, req.headers.get("origin"), req.headers.get("host"))) {
    return NextResponse.json({ error: "คำขอไม่ถูกต้อง" }, { status: 403 });
  }
  if (!isParserConfigWritable()) {
    return NextResponse.json(
      { error: "ยังไม่ได้ตั้งค่า POSTGRES_URL — โหมดอ่านอย่างเดียว แก้ผ่าน data/branch-config.json + PR" },
      { status: 405 }
    );
  }
  const rate = consumeApiRateLimit(req.headers, "parser-config-write", 30, 60_000);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "แก้ไขบ่อยเกินไป กรุณารอสักครู่" },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } }
    );
  }
  return null;
}

// POST /api/branches — add or update a branch.
export async function POST(req: NextRequest) {
  const denied = mutationDenied(req);
  if (denied) return denied;

  let body: { code?: string; name?: string; isTest?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "รูปแบบคำขอไม่ถูกต้อง" }, { status: 400 });
  }
  const code = String(body.code || "").trim().toUpperCase();
  const name = String(body.name || "").trim();
  if (!code || !name) {
    return NextResponse.json({ error: "กรุณาระบุรหัสและชื่อสาขา" }, { status: 400 });
  }
  if (!/^[A-Z0-9-]{1,20}$/.test(code)) {
    return NextResponse.json({ error: "รหัสสาขาต้องเป็น A-Z, 0-9 หรือ - ยาวไม่เกิน 20 ตัว" }, { status: 400 });
  }
  if (name.length > 100) {
    return NextResponse.json({ error: "ชื่อสาขายาวเกินไป" }, { status: 400 });
  }

  try {
    await upsertParserConfig("branch", code, name, Boolean(body.isTest));
    return NextResponse.json({ branches: await currentBranches(), writable: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "บันทึกไม่สำเร็จ" },
      { status: 500 }
    );
  }
}

// DELETE /api/branches?code=XXX — remove a branch.
export async function DELETE(req: NextRequest) {
  const denied = mutationDenied(req);
  if (denied) return denied;

  const code = String(req.nextUrl.searchParams.get("code") || "").trim().toUpperCase();
  if (!code) {
    return NextResponse.json({ error: "กรุณาระบุรหัสสาขา" }, { status: 400 });
  }

  try {
    await deleteParserConfig("branch", code);
    return NextResponse.json({ branches: await currentBranches(), writable: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "ลบไม่สำเร็จ" },
      { status: 500 }
    );
  }
}
