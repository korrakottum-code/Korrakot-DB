import { createHash, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

/**
 * Auth สำหรับ API ภายนอก (เช่น Qlass ดึงยอดโฆษณาไปทำ CPO) — แยกจาก
 * INTERNAL_DASHBOARD_PASSWORD/SECRET ของหน้าเว็บโดยสิ้นเชิง เพื่อไม่ให้ระบบ
 * ภายนอกถือรหัสผ่านทีมงาน และเพิกถอนสิทธิ์ภายนอกได้โดยไม่กระทบ Login ทีม
 *
 * ใช้ Bearer token เทียบแบบ timing-safe (เหมือน lib/internal-auth.ts) และ
 * fail-closed: ถ้ายังไม่ตั้งค่า EXTERNAL_API_KEY ระบบปิดรับ request ทั้งหมด
 */

const MIN_KEY_LENGTH = 32;

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

function secureEqual(left: string, right: string): boolean {
  return timingSafeEqual(digest(left), digest(right));
}

export function readExternalApiKey(env: Record<string, string | undefined> = process.env): string | null {
  const key = env.EXTERNAL_API_KEY || "";
  return key.length >= MIN_KEY_LENGTH ? key : null;
}

export function verifyExternalApiKey(input: string | null, expected: string): boolean {
  if (!input) return false;
  return secureEqual(input, expected);
}

function extractBearerToken(request: NextRequest): string | null {
  const header = request.headers.get("authorization") || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

export function requireExternalApiAuth(request: NextRequest): NextResponse | null {
  const key = readExternalApiKey();
  if (!key) {
    return NextResponse.json(
      { error: "External API ยังไม่ได้ตั้งค่า" },
      { status: 503, headers: { "Cache-Control": "private, no-store" } }
    );
  }

  const token = extractBearerToken(request);
  if (!verifyExternalApiKey(token, key)) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: { "Cache-Control": "private, no-store" } }
    );
  }

  return null;
}
