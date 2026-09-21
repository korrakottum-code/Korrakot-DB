import { NextRequest, NextResponse } from "next/server";
import { syncAllPancakeEvents } from "@/lib/pancake-store";
import { logSyncFailures } from "@/lib/insights-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// อาจต้องรอ Pancake หลายสิบเพจ (concurrency 5) ให้เวลาพอ
export const maxDuration = 120;

/**
 * Vercel Cron เรียก endpoint นี้ทุกวัน (ดู vercel.json) เพื่อเก็บ pancake_response_events
 * ถาวรลง Postgres — ป้องกันข้อมูลหายเพราะ Pancake ให้ดึงได้แค่ "บทสนทนาล่าสุด N รายการ"
 * ต่อเพจ ถ้าไม่ sync บ่อยพอ ของเก่าจะหลุดหน้าต่างไปเงียบๆ (ดู lib/pancake.ts, lib/pancake-store.ts)
 *
 * Vercel แนบ header Authorization: Bearer $CRON_SECRET มาให้อัตโนมัติเมื่อเรียกจาก cron จริง —
 * เช็คให้ตรงกันกันคนนอกยิง endpoint นี้เล่นแล้วโดน rate limit ฝั่ง Pancake token แทน
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "ยังไม่ได้ตั้งค่า CRON_SECRET" }, { status: 503 });
  }
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const token = process.env.PANCAKE_ACCESS_TOKEN;
  if (!token) {
    return NextResponse.json({ error: "ยังไม่ได้ตั้งค่า PANCAKE_ACCESS_TOKEN" }, { status: 503 });
  }

  try {
    const result = await syncAllPancakeEvents(token);
    if (result.pagesFailed.length > 0) {
      await logSyncFailures(
        "pancake-cron-sync",
        result.pagesFailed.map((f) => ({ accountId: f.pageId, accountName: f.name, message: f.message }))
      );
    }
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    await logSyncFailures("pancake-cron-sync", [{ message }]);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
