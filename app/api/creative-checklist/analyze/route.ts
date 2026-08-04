import { NextRequest, NextResponse } from "next/server";
import { requireInternalApiAuth } from "@/lib/api-auth";
import { consumeApiRateLimit } from "@/lib/rate-limit";
import { isSameOriginRequest } from "@/lib/security";
import { readChecklistConfig } from "@/lib/creative-checklist-store";
import { scoreChecklist, manualCheckItems, type MediaType } from "@/lib/creative-checklist";
import { scoreImageAgainstChecklist, ChecklistAiError } from "@/lib/creative-checklist-ai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_FILE_BYTES = 8 * 1024 * 1024;
const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

export async function POST(req: NextRequest) {
  const denied = requireInternalApiAuth(req);
  if (denied) return denied;

  if (!isSameOriginRequest(req.url, req.headers.get("origin"), req.headers.get("host"))) {
    return NextResponse.json({ error: "คำขอไม่ถูกต้อง" }, { status: 403 });
  }

  const rate = consumeApiRateLimit(req.headers, "creative-checklist-analyze", 20, 60_000);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "วิเคราะห์ภาพบ่อยเกินไป กรุณารอสักครู่" },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } }
    );
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "ยังไม่ได้ตั้งค่า OPENAI_API_KEY บนเซิร์ฟเวอร์" }, { status: 503 });
  }

  const config = readChecklistConfig();
  if (!config) {
    return NextResponse.json({ error: "ไม่พบไฟล์ checklist" }, { status: 500 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "รูปแบบคำขอไม่ถูกต้อง" }, { status: 400 });
  }

  const file = form.get("image");
  const mediaTypeRaw = String(form.get("mediaType") || "image");
  const mediaType: MediaType = mediaTypeRaw === "video" ? "video" : "image";

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "กรุณาแนบไฟล์ภาพ" }, { status: 400 });
  }
  if (!ALLOWED_MIME.has(file.type)) {
    return NextResponse.json({ error: "รองรับเฉพาะไฟล์ JPG, PNG หรือ WEBP" }, { status: 400 });
  }
  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json({ error: "ไฟล์ใหญ่เกินไป (จำกัด 8MB)" }, { status: 400 });
  }

  const allItems = config.categories.flatMap((category) => category.items);
  const relevantItems = allItems.filter(
    (item) =>
      // ข้อที่ต้องดูวิดีโอจริงตัดสินจากภาพนิ่งไม่ได้ — ไม่ส่งให้ AI, ให้ user ตรวจเองแทน
      !item.requiresVideoPlayback &&
      (!item.appliesTo || item.appliesTo === "both" || item.appliesTo === mediaType)
  );

  const buffer = Buffer.from(await file.arrayBuffer());
  const dataUrl = `data:${file.type};base64,${buffer.toString("base64")}`;

  let results;
  try {
    results = await scoreImageAgainstChecklist(apiKey, dataUrl, relevantItems, mediaType);
  } catch (err) {
    if (err instanceof ChecklistAiError) {
      return NextResponse.json({ error: err.message, detail: err.detail }, { status: err.status || 502 });
    }
    return NextResponse.json({ error: "วิเคราะห์ภาพไม่สำเร็จ" }, { status: 502 });
  }

  const reasonById = new Map(results.map((r) => [r.id, r]));
  const checkedIds = results.filter((r) => r.met).map((r) => r.id);
  const score = scoreChecklist(config, checkedIds, mediaType);

  return NextResponse.json({
    mediaType,
    checkedIds,
    reasons: Object.fromEntries(reasonById),
    score,
    manualItems: manualCheckItems(config, mediaType).map(({ categoryLabel, item }) => ({
      categoryLabel,
      id: item.id,
      label: item.label,
    })),
    configVersion: config.version,
  });
}
