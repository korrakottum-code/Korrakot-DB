import { NextRequest, NextResponse } from "next/server";
import { requireInternalApiAuth } from "@/lib/api-auth";
import { consumeApiRateLimit } from "@/lib/rate-limit";
import { readSyncErrors } from "@/lib/insights-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * ดู error log ของงานเบื้องหลัง (sync/กวาดชื่อแอด) ย้อนหลัง — เปิดในเบราว์เซอร์ได้เลย:
 * /api/sync-errors            → 100 รายการล่าสุด
 * /api/sync-errors?limit=500  → มากสุด 500 รายการ
 */
export async function GET(req: NextRequest) {
  const denied = requireInternalApiAuth(req);
  if (denied) return denied;

  const rate = consumeApiRateLimit(req.headers, "sync-errors", 60, 60_000);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "เรียกข้อมูลบ่อยเกินไป" },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } }
    );
  }

  try {
    const limit = Number(req.nextUrl.searchParams.get("limit")) || 100;
    const errors = await readSyncErrors(limit);
    const bySource: Record<string, number> = {};
    for (const e of errors) {
      const key = e.source.split(" ")[0];
      bySource[key] = (bySource[key] || 0) + 1;
    }
    return NextResponse.json({ count: errors.length, bySource, errors });
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Unknown error" }, { status: 500 });
  }
}
