import { NextRequest, NextResponse } from "next/server";
import { requireInternalApiAuth } from "@/lib/api-auth";
import { consumeApiRateLimit } from "@/lib/rate-limit";
import { isSameOriginRequest } from "@/lib/security";
import {
  isPromoGroupWritable,
  readPromoGroups,
  upsertPromoGroup,
  deletePromoGroup,
} from "@/lib/creative-promo-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/creative-promo-groups — groupKey → promoGroup ทั้งหมด
export async function GET(req: NextRequest) {
  const denied = requireInternalApiAuth(req);
  if (denied) return denied;

  try {
    if (!isPromoGroupWritable()) {
      return NextResponse.json({ promoGroups: {}, writable: false });
    }
    const promoGroups = await readPromoGroups();
    return NextResponse.json({ promoGroups, writable: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "อ่านข้อมูลไม่สำเร็จ" },
      { status: 500 }
    );
  }
}

// POST /api/creative-promo-groups — { groupKey, promoGroup } upsert; promoGroup ว่าง = ลบแท็ก
export async function POST(req: NextRequest) {
  const denied = requireInternalApiAuth(req);
  if (denied) return denied;
  if (!isSameOriginRequest(req.url, req.headers.get("origin"), req.headers.get("host"))) {
    return NextResponse.json({ error: "คำขอไม่ถูกต้อง" }, { status: 403 });
  }
  if (!isPromoGroupWritable()) {
    return NextResponse.json({ error: "ยังไม่ได้ตั้งค่า POSTGRES_URL" }, { status: 405 });
  }
  const rate = consumeApiRateLimit(req.headers, "creative-promo-group-write", 60, 60_000);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "แก้ไขบ่อยเกินไป กรุณารอสักครู่" },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } }
    );
  }

  let body: { groupKey?: string; promoGroup?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "รูปแบบคำขอไม่ถูกต้อง" }, { status: 400 });
  }
  const groupKey = String(body.groupKey || "").trim();
  const promoGroup = String(body.promoGroup || "").trim();
  if (!groupKey) {
    return NextResponse.json({ error: "กรุณาระบุ groupKey" }, { status: 400 });
  }
  if (groupKey.length > 40 || promoGroup.length > 60) {
    return NextResponse.json({ error: "ข้อมูลยาวเกินไป" }, { status: 400 });
  }

  try {
    if (promoGroup) {
      await upsertPromoGroup(groupKey, promoGroup);
    } else {
      await deletePromoGroup(groupKey);
    }
    return NextResponse.json({ promoGroups: await readPromoGroups(), writable: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "บันทึกไม่สำเร็จ" },
      { status: 500 }
    );
  }
}
