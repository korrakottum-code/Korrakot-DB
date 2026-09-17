import { NextRequest, NextResponse } from "next/server";
import { requireInternalApiAuth } from "@/lib/api-auth";
import { consumeApiRateLimit } from "@/lib/rate-limit";
import { getServerCache } from "@/lib/server-cache";
import { fetchAllPagesConversations, statsForDay, todayBangkokDateStr, bangkokDayRangeMs } from "@/lib/pancake";

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
    // DEBUG: ชั่วคราวเพื่อไล่บั๊กตัวเลขไม่ตรงระหว่าง local/production — ลบทิ้งหลังหาสาเหตุเจอ
    const target = cached.value.find((r) => r.name.includes("ลาดกระบัง"));
    const dayRange = bangkokDayRangeMs(date);
    const targetTimes = (target?.conversations || [])
      .map((c) => c.last_customer_interactive_at)
      .filter(Boolean) as string[];
    console.log("[admin-response-time-debug]", JSON.stringify({
      requestedDate: date,
      serverNow: new Date().toISOString(),
      dayRangeSince: new Date(dayRange.sinceMs).toISOString(),
      dayRangeUntil: new Date(dayRange.untilMs).toISOString(),
      cacheHit: cached.hit,
      cacheFetchedAt: cached.fetchedAt,
      allPageNamesMatchingLadkrabang: cached.value.filter((r) => r.name.includes("ลาดกระบัง")).map((r) => r.pageId + ":" + r.name),
      targetPageId: target?.pageId,
      targetRawCount: targetTimes.length,
      targetInDayCount: targetTimes.filter((t) => {
        const ms = new Date(t).getTime();
        return ms >= dayRange.sinceMs && ms < dayRange.untilMs;
      }).length,
      targetMinTime: targetTimes.length ? targetTimes.reduce((a, b) => (a < b ? a : b)) : null,
      targetMaxTime: targetTimes.length ? targetTimes.reduce((a, b) => (a > b ? a : b)) : null,
    }));
    return NextResponse.json({
      date,
      pages,
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
