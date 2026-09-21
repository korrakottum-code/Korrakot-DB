import { NextRequest, NextResponse } from "next/server";
import { requireInternalApiAuth } from "@/lib/api-auth";
import { consumeApiRateLimit } from "@/lib/rate-limit";
import { isSameOriginRequest } from "@/lib/security";
import { syncAllPancakeEvents } from "@/lib/pancake-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// ปุ่ม "ซิงก์ตอนนี้" ในหน้า /admin — เรียก sync เดียวกับที่ cron รันทุกคืน แต่ทริกเกอร์เองได้
// ระหว่างวันถ้าอยากได้ตัวเลขของวันนี้สดกว่ารอบ cron ปกติ (ไม่ต้องรอถึงเที่ยงคืน)
export async function POST(req: NextRequest) {
  const denied = requireInternalApiAuth(req);
  if (denied) return denied;

  if (!isSameOriginRequest(req.url, req.headers.get("origin"), req.headers.get("host"))) {
    return NextResponse.json({ error: "คำขอไม่ถูกต้อง" }, { status: 403 });
  }

  const rate = consumeApiRateLimit(req.headers, "admin-sync-pancake-now", 3, 60_000);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "ซิงก์บ่อยเกินไป กรุณารอสักครู่" },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } }
    );
  }

  const token = process.env.PANCAKE_ACCESS_TOKEN;
  if (!token) {
    return NextResponse.json({ error: "ยังไม่ได้ตั้งค่า PANCAKE_ACCESS_TOKEN" }, { status: 503 });
  }

  try {
    const result = await syncAllPancakeEvents(token);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "ซิงก์ข้อมูล Pancake ไม่สำเร็จ" },
      { status: 500 }
    );
  }
}
