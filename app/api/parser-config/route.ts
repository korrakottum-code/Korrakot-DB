import { NextRequest, NextResponse } from "next/server";
import { requireInternalApiAuth } from "@/lib/api-auth";
import { consumeApiRateLimit } from "@/lib/rate-limit";
import { isSameOriginRequest } from "@/lib/security";
import {
  isParserConfigWritable,
  readParserConfig,
  upsertParserConfig,
  deleteParserConfig,
  normalizeSubCode,
  type ConfigKind,
} from "@/lib/parser-config-store";
import { PROGRAM_MAP, SUB_MAP } from "@/lib/parser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/parser-config — โปรแกรมและหมวดย่อยที่มีผลจริง (+ แก้ไขได้ไหม)
export async function GET(req: NextRequest) {
  const denied = requireInternalApiAuth(req);
  if (denied) return denied;

  try {
    if (isParserConfigWritable()) {
      const config = await readParserConfig();
      return NextResponse.json({ programs: config.programs, subs: config.subs, writable: true });
    }
    return NextResponse.json({ programs: PROGRAM_MAP, subs: SUB_MAP, writable: false });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "อ่านข้อมูลไม่สำเร็จ" },
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
      { error: "ยังไม่ได้ตั้งค่า POSTGRES_URL — โหมดอ่านอย่างเดียว" },
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

function parseKind(value: string | null | undefined): ConfigKind | null {
  return value === "program" || value === "sub" ? value : null;
}

// POST /api/parser-config — เพิ่ม/แก้ โปรแกรมหรือหมวดย่อย
export async function POST(req: NextRequest) {
  const denied = mutationDenied(req);
  if (denied) return denied;

  let body: { kind?: string; code?: string; name?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "รูปแบบคำขอไม่ถูกต้อง" }, { status: 400 });
  }
  const kind = parseKind(body.kind);
  let code = String(body.code || "").trim().toUpperCase();
  const name = String(body.name || "").trim();
  if (!kind) {
    return NextResponse.json({ error: "kind ต้องเป็น program หรือ sub" }, { status: 400 });
  }
  if (!code || !name) {
    return NextResponse.json({ error: "กรุณาระบุรหัสและชื่อ" }, { status: 400 });
  }
  // program = ตัวอักษรล้วน (เช่น F, ALL) / sub = โปรแกรม+เลข 2 หลักตาม ad name จริง (เช่น B02, ALL03)
  if (kind === "program" && !/^[A-Z]{1,10}$/.test(code)) {
    return NextResponse.json({ error: "รหัสโปรแกรมต้องเป็นตัวอักษร A-Z ล้วน (เช่น F, ALL)" }, { status: 400 });
  }
  if (kind === "sub") {
    if (!/^[A-Z]{1,10}\d{1,2}$/.test(code)) {
      return NextResponse.json({ error: "รหัสหมวดย่อยต้องเป็นโปรแกรม+เลข (เช่น B02, ALL03)" }, { status: 400 });
    }
    // เก็บเป็นเลข 2 หลักเสมอให้ตรงกับรหัสใน ad name (B2 → B02) กันรายการซ้ำสองรูปแบบ
    code = normalizeSubCode(code);
  }
  if (name.length > 100) {
    return NextResponse.json({ error: "ชื่อยาวเกินไป" }, { status: 400 });
  }

  try {
    await upsertParserConfig(kind, code, name);
    const config = await readParserConfig();
    return NextResponse.json({ programs: config.programs, subs: config.subs, writable: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "บันทึกไม่สำเร็จ" },
      { status: 500 }
    );
  }
}

// DELETE /api/parser-config?kind=program&code=X
export async function DELETE(req: NextRequest) {
  const denied = mutationDenied(req);
  if (denied) return denied;

  const kind = parseKind(req.nextUrl.searchParams.get("kind"));
  let code = String(req.nextUrl.searchParams.get("code") || "").trim().toUpperCase();
  if (!kind || !code) {
    return NextResponse.json({ error: "กรุณาระบุ kind และ code" }, { status: 400 });
  }
  if (kind === "sub") code = normalizeSubCode(code);

  try {
    await deleteParserConfig(kind, code);
    const config = await readParserConfig();
    return NextResponse.json({ programs: config.programs, subs: config.subs, writable: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "ลบไม่สำเร็จ" },
      { status: 500 }
    );
  }
}
