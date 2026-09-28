import { NextRequest, NextResponse } from "next/server";
import { requireInternalApiAuth } from "@/lib/api-auth";
import { consumeApiRateLimit } from "@/lib/rate-limit";
import { todayBangkokDateStr } from "@/lib/pancake";
import { readPageStatsForRange, readAdminStatsForRange, readLastSyncedAt } from "@/lib/pancake-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// กันเลือกช่วงกว้างเกินจนดูผลลัพธ์แล้วเข้าใจผิดว่าครบทั้งที่ข้อมูลเพิ่งเริ่มเก็บ (ดู lib/pancake-store.ts)
const MAX_RANGE_DAYS = 45;

export async function GET(req: NextRequest) {
  const denied = requireInternalApiAuth(req);
  if (denied) return denied;

  const rate = consumeApiRateLimit(req.headers, "admin-response-time", 20, 60_000);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "เรียกข้อมูลบ่อยเกินไป กรุณารอสักครู่" },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } }
    );
  }

  const today = todayBangkokDateStr();
  // date เป็นชื่อ param เดิม (วันเดียว) เก็บไว้ให้เข้ากันได้ — since/until คือของใหม่สำหรับเลือกเป็นช่วง
  const legacyDate = req.nextUrl.searchParams.get("date");
  const since = req.nextUrl.searchParams.get("since") || legacyDate || today;
  const until = req.nextUrl.searchParams.get("until") || legacyDate || since;
  if (!DATE_RE.test(since) || !DATE_RE.test(until)) {
    return NextResponse.json({ error: "รูปแบบวันที่ไม่ถูกต้อง (ต้องเป็น YYYY-MM-DD)" }, { status: 400 });
  }
  if (since > until) {
    return NextResponse.json({ error: "วันที่เริ่มต้องไม่มากกว่าวันที่สิ้นสุด" }, { status: 400 });
  }
  const rangeDays = Math.round((Date.parse(until) - Date.parse(since)) / 86_400_000) + 1;
  if (rangeDays > MAX_RANGE_DAYS) {
    return NextResponse.json({ error: `เลือกช่วงได้ไม่เกิน ${MAX_RANGE_DAYS} วัน` }, { status: 400 });
  }

  try {
    const [pages, byAdmin, lastSyncedAt] = await Promise.all([
      readPageStatsForRange(since, until),
      readAdminStatsForRange(since, until),
      readLastSyncedAt(),
    ]);
    return NextResponse.json({ since, until, pages, byAdmin, lastSyncedAt });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "อ่านข้อมูลจาก DB ไม่สำเร็จ" },
      { status: 500 }
    );
  }
}
