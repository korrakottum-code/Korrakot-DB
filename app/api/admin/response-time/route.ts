import { NextRequest, NextResponse } from "next/server";
import { requireInternalApiAuth } from "@/lib/api-auth";
import { consumeApiRateLimit } from "@/lib/rate-limit";
import { getServerCache } from "@/lib/server-cache";
import { fetchAllPagesConversations, statsForDay, statsByAdminForDay, todayBangkokDateStr } from "@/lib/pancake";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ก้อนบทสนทนาดิบ (ไม่กรองวันที่) แคชไว้สั้นๆ — สลับดูวันไหนก็คำนวณจากก้อนเดียวกัน ไม่ต้องยิง Pancake ใหม่ทุกครั้ง
const CACHE_TTL_MS = 5 * 60 * 1000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

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

  const date = req.nextUrl.searchParams.get("date") || todayBangkokDateStr();
  if (!DATE_RE.test(date)) {
    return NextResponse.json({ error: "รูปแบบวันที่ไม่ถูกต้อง (ต้องเป็น YYYY-MM-DD)" }, { status: 400 });
  }
  const forceRefresh = req.nextUrl.searchParams.get("refresh") === "1";

  try {
    const cached = await getServerCache(
      "admin-response-time-raw",
      CACHE_TTL_MS,
      () => fetchAllPagesConversations(token),
      forceRefresh
    );
    const pages = statsForDay(cached.value, date);
    const byAdmin = statsByAdminForDay(cached.value, date);
    return NextResponse.json({
      date,
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
