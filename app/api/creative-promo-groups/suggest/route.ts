import { NextRequest, NextResponse } from "next/server";
import { requireInternalApiAuth } from "@/lib/api-auth";
import { consumeApiRateLimit } from "@/lib/rate-limit";
import { isSameOriginRequest, isAllowedMetaMediaUrl } from "@/lib/security";
import { suggestPromoGroup } from "@/lib/promo-group-ai";
import { ChecklistAiError } from "@/lib/creative-checklist-ai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/creative-promo-groups/suggest — { imageUrl } → ให้ AI เดาราคา/โปรโมชั่นจากรูปครีเอทีฟ
export async function POST(req: NextRequest) {
  const denied = requireInternalApiAuth(req);
  if (denied) return denied;
  if (!isSameOriginRequest(req.url, req.headers.get("origin"), req.headers.get("host"))) {
    return NextResponse.json({ error: "คำขอไม่ถูกต้อง" }, { status: 403 });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "ยังไม่ได้ตั้งค่า OPENAI_API_KEY บนเซิร์ฟเวอร์" }, { status: 503 });
  }

  const rate = consumeApiRateLimit(req.headers, "creative-promo-group-suggest", 30, 60_000);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "เรียกใช้บ่อยเกินไป กรุณารอสักครู่" },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } }
    );
  }

  let body: { imageUrl?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "รูปแบบคำขอไม่ถูกต้อง" }, { status: 400 });
  }
  const imageUrl = String(body.imageUrl || "").trim();
  if (!imageUrl) {
    return NextResponse.json({ error: "กรุณาระบุ imageUrl" }, { status: 400 });
  }
  // กัน SSRF — เฉพาะรูปจาก Meta CDN เท่านั้นที่ยอมให้ดึงจากฝั่งเซิร์ฟเวอร์
  if (!isAllowedMetaMediaUrl(imageUrl)) {
    return NextResponse.json({ error: "URL รูปภาพไม่ได้รับอนุญาต" }, { status: 400 });
  }

  try {
    const result = await suggestPromoGroup(apiKey, imageUrl);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof ChecklistAiError) {
      return NextResponse.json({ error: err.message, detail: err.detail }, { status: err.status || 502 });
    }
    return NextResponse.json({ error: "เดาราคาไม่สำเร็จ" }, { status: 502 });
  }
}
