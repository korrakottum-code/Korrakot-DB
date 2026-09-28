import { NextRequest, NextResponse } from "next/server";
import { requireInternalApiAuth } from "@/lib/api-auth";
import { consumeApiRateLimit } from "@/lib/rate-limit";
import { getServerCache } from "@/lib/server-cache";
import { fetchAllPagesConversations, statsForDateRange, statsByAdminForDateRange, todayBangkokDateStr } from "@/lib/pancake";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ก้อนบทสนทนาดิบ (ไม่กรองวันที่) แคชไว้สั้นๆ — สลับดูช่วงไหนก็คำนวณจากก้อนเดียวกัน ไม่ต้องยิง Pancake ใหม่ทุกครั้ง
const CACHE_TTL_MS = 5 * 60 * 1000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// กันเลือกช่วงกว้างเกินจนโหลดหนัก/ดูผลลัพธ์แล้วเข้าใจผิดว่าครบ (Pancake ให้ดึงย้อนได้จำกัดอยู่แล้ว)
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

  const token = process.env.PANCAKE_ACCESS_TOKEN;
  if (!token) {
    return NextResponse.json(
      { error: "ยังไม่ได้ตั้งค่า PANCAKE_ACCESS_TOKEN" },
      { status: 503 }
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
  const forceRefresh = req.nextUrl.searchParams.get("refresh") === "1";

  try {
    const cached = await getServerCache(
      "admin-response-time-raw",
      CACHE_TTL_MS,
      () => fetchAllPagesConversations(token),
      forceRefresh
    );
    const pages = statsForDateRange(cached.value, since, until);
    const byAdmin = statsByAdminForDateRange(cached.value, since, until);
    return NextResponse.json({
      since,
      until,
      pages,
      byAdmin,
      fetchedAt: cached.fetchedAt,
      cache: { hit: cached.hit },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "ดึงข้อมูลจาก Pancake ไม่สำเร็จ" },
      { status: 500 }
    );
  }
}
