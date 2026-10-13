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

// รหัสแยกรายผู้เรียก — ให้ระบบใหม่มีรหัสของตัวเอง โดย EXTERNAL_API_KEY เดิมที่ระบบอื่นใช้อยู่ไม่ต้องเปลี่ยน
// เพิกถอนรายตัวได้แค่ลบตัวแปรนั้น (ยาวไม่ถึง MIN_KEY_LENGTH = ถือว่าไม่ได้ตั้งค่า เหมือน fail-closed ของตัวหลัก)
const PER_CONSUMER_KEY_NAMES = ["EXTERNAL_API_KEY_QLASS"] as const;

export function readExternalApiKeys(env: Record<string, string | undefined> = process.env): string[] {
  const keys: string[] = [];
  const primary = readExternalApiKey(env);
  if (primary) keys.push(primary);
  for (const name of PER_CONSUMER_KEY_NAMES) {
    const value = env[name] || "";
    if (value.length >= MIN_KEY_LENGTH && !keys.includes(value)) keys.push(value);
  }
  return keys;
}

// เทียบกับทุกรหัสเสมอ ไม่หยุดเมื่อเจอตัวแรกที่ตรง — เวลาตอบไม่บอกว่าตรงกับรหัสลำดับไหน
export function verifyAnyExternalApiKey(input: string | null, expectedKeys: string[]): boolean {
  if (!input || expectedKeys.length === 0) return false;
  let matched = false;
  for (const expected of expectedKeys) {
    if (secureEqual(input, expected)) matched = true;
  }
  return matched;
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
  const keys = readExternalApiKeys();
  if (keys.length === 0) {
    return NextResponse.json(
      { error: "External API ยังไม่ได้ตั้งค่า" },
      { status: 503, headers: { "Cache-Control": "private, no-store" } }
    );
  }

  const token = extractBearerToken(request);
  if (!verifyAnyExternalApiKey(token, keys)) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: { "Cache-Control": "private, no-store" } }
    );
  }

  return null;
}
