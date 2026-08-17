import { NextRequest, NextResponse } from "next/server";
import { requireInternalApiAuth } from "@/lib/api-auth";
import { consumeApiRateLimit } from "@/lib/rate-limit";
import { isSameOriginRequest } from "@/lib/security";
import {
  isPromoGroupWritable,
  readPromoGroups,
  upsertPromoGroup,
  deletePromoGroup,
  renamePromoGroup,
  deletePromoGroupEverywhere,
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

function mutationDenied(req: NextRequest): NextResponse | null {
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
  return null;
}

// POST /api/creative-promo-groups — { groupKey, promoGroup } upsert แท็กของ "ชิ้นเดียว"
// promoGroup ว่าง = ลบแท็กของชิ้นนั้น
export async function POST(req: NextRequest) {
  const denied = mutationDenied(req);
  if (denied) return denied;

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

// PATCH /api/creative-promo-groups — { from, to } เปลี่ยนชื่อกลุ่มโปรโมชั่นทั้งกลุ่มทีเดียว
// (แก้ชื่อที่พิมพ์ผิด — ย้ายทุกชิ้นที่แท็กด้วยชื่อเดิมไปชื่อใหม่ในคำสั่งเดียว)
export async function PATCH(req: NextRequest) {
  const denied = mutationDenied(req);
  if (denied) return denied;

  let body: { from?: string; to?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "รูปแบบคำขอไม่ถูกต้อง" }, { status: 400 });
  }
  const from = String(body.from || "").trim();
  const to = String(body.to || "").trim();
  if (!from || !to) {
    return NextResponse.json({ error: "กรุณาระบุชื่อเดิมและชื่อใหม่" }, { status: 400 });
  }
  if (to.length > 60) {
    return NextResponse.json({ error: "ชื่อใหม่ยาวเกินไป" }, { status: 400 });
  }
  if (from === to) {
    return NextResponse.json({ promoGroups: await readPromoGroups(), writable: true });
  }

  try {
    await renamePromoGroup(from, to);
    return NextResponse.json({ promoGroups: await readPromoGroups(), writable: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "เปลี่ยนชื่อไม่สำเร็จ" },
      { status: 500 }
    );
  }
}

// DELETE /api/creative-promo-groups?promoGroup=xxx — เลิกใช้กลุ่มนี้ทั้งกลุ่ม
// (ล้างแท็กออกจากทุกชิ้นที่ใช้ชื่อนี้ในคำสั่งเดียว ต่างจากการล้างทีละชิ้นผ่าน POST)
export async function DELETE(req: NextRequest) {
  const denied = mutationDenied(req);
  if (denied) return denied;

  const promoGroup = String(req.nextUrl.searchParams.get("promoGroup") || "").trim();
  if (!promoGroup) {
    return NextResponse.json({ error: "กรุณาระบุ promoGroup" }, { status: 400 });
  }

  try {
    await deletePromoGroupEverywhere(promoGroup);
    return NextResponse.json({ promoGroups: await readPromoGroups(), writable: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "ลบไม่สำเร็จ" },
      { status: 500 }
    );
  }
}
