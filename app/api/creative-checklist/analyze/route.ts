import { NextRequest, NextResponse } from "next/server";
import { requireInternalApiAuth } from "@/lib/api-auth";
import { consumeApiRateLimit } from "@/lib/rate-limit";
import { isSameOriginRequest } from "@/lib/security";
import { readChecklistConfig } from "@/lib/creative-checklist-store";
import { scoreChecklist, type ChecklistItem, type MediaType } from "@/lib/creative-checklist";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

interface AiItemResult {
  id: string;
  met: boolean;
  reason: string;
}

function buildJsonSchema(itemIds: string[]) {
  return {
    name: "creative_checklist_result",
    strict: true,
    schema: {
      type: "object",
      properties: {
        results: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string", enum: itemIds },
              met: { type: "boolean" },
              reason: { type: "string", description: "เหตุผลสั้น ๆ ภาษาไทยว่าทำไมผ่านหรือไม่ผ่าน" },
            },
            required: ["id", "met", "reason"],
            additionalProperties: false,
          },
        },
      },
      required: ["results"],
      additionalProperties: false,
    },
  };
}

function buildPrompt(items: ChecklistItem[], mediaType: MediaType): string {
  const list = items.map((item) => `- id="${item.id}": ${item.label}`).join("\n");
  const kindText = mediaType === "video" ? "เฟรมภาพตัวแทนจากวิดีโอโฆษณา" : "ภาพนิ่งโฆษณา";
  return [
    `นี่คือ${kindText}ของคลินิกเสริมความงาม (Class Clinic) ที่กำลังจะใช้ลงโฆษณา Facebook/Instagram`,
    "ให้ประเมินภาพนี้เทียบกับรายการเกณฑ์ด้านล่างทีละข้อ โดยตัดสินจากสิ่งที่เห็นในภาพจริงเท่านั้น อย่าเดาโดยไม่มีหลักฐานในภาพ",
    "ตอบ met=true เฉพาะเมื่อภาพแสดงหลักฐานของเกณฑ์นั้นชัดเจน ถ้าไม่แน่ใจหรือมองไม่เห็นหลักฐาน ให้ตอบ met=false",
    "",
    "เกณฑ์:",
    list,
  ].join("\n");
}

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
    (item) => !item.appliesTo || item.appliesTo === "both" || item.appliesTo === mediaType
  );

  const buffer = Buffer.from(await file.arrayBuffer());
  const dataUrl = `data:${file.type};base64,${buffer.toString("base64")}`;

  let aiResponse: Response;
  try {
    aiResponse = await fetch(OPENAI_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-4o",
        messages: [
          {
            role: "system",
            content:
              "คุณคือผู้เชี่ยวชาญตรวจสอบครีเอทีฟโฆษณา Meta Ads ของคลินิกเสริมความงามไทย ตอบเป็น JSON ตามสคีมาที่กำหนดเท่านั้น",
          },
          {
            role: "user",
            content: [
              { type: "text", text: buildPrompt(relevantItems, mediaType) },
              { type: "image_url", image_url: { url: dataUrl } },
            ],
          },
        ],
        response_format: { type: "json_schema", json_schema: buildJsonSchema(relevantItems.map((i) => i.id)) },
        max_tokens: 2000,
      }),
    });
  } catch {
    return NextResponse.json({ error: "เรียก AI วิเคราะห์ภาพไม่สำเร็จ" }, { status: 502 });
  }

  if (!aiResponse.ok) {
    const errText = await aiResponse.text().catch(() => "");
    return NextResponse.json(
      { error: `AI วิเคราะห์ภาพล้มเหลว (${aiResponse.status})`, detail: errText.slice(0, 500) },
      { status: 502 }
    );
  }

  const aiJson = await aiResponse.json();
  const rawContent: string | undefined = aiJson?.choices?.[0]?.message?.content;
  if (!rawContent) {
    return NextResponse.json({ error: "AI ไม่ได้ส่งผลลัพธ์กลับมา" }, { status: 502 });
  }

  let parsed: { results: AiItemResult[] };
  try {
    parsed = JSON.parse(rawContent);
  } catch {
    return NextResponse.json({ error: "แปลงผลลัพธ์จาก AI ไม่สำเร็จ" }, { status: 502 });
  }

  const reasonById = new Map(parsed.results.map((r) => [r.id, r]));
  const checkedIds = parsed.results.filter((r) => r.met).map((r) => r.id);
  const score = scoreChecklist(config, checkedIds, mediaType);

  return NextResponse.json({
    mediaType,
    checkedIds,
    reasons: Object.fromEntries(reasonById),
    score,
    configVersion: config.version,
  });
}
