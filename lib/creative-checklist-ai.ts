import type { ChecklistItem, MediaType } from "./creative-checklist";

const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";

export interface AiItemResult {
  id: string;
  met: boolean;
  reason: string;
}

export function buildChecklistJsonSchema(itemIds: string[]) {
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

export function buildChecklistPrompt(items: ChecklistItem[], mediaType: MediaType): string {
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

export class ChecklistAiError extends Error {
  status?: number;
  detail?: string;
  constructor(message: string, status?: number, detail?: string) {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}

export async function scoreImageAgainstChecklist(
  apiKey: string,
  imageUrl: string,
  items: ChecklistItem[],
  mediaType: MediaType
): Promise<AiItemResult[]> {
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
              { type: "text", text: buildChecklistPrompt(items, mediaType) },
              { type: "image_url", image_url: { url: imageUrl } },
            ],
          },
        ],
        response_format: { type: "json_schema", json_schema: buildChecklistJsonSchema(items.map((i) => i.id)) },
        max_tokens: 2000,
      }),
    });
  } catch (err) {
    throw new ChecklistAiError("เรียก AI วิเคราะห์ภาพไม่สำเร็จ", undefined, err instanceof Error ? err.message : undefined);
  }

  if (!aiResponse.ok) {
    const errText = await aiResponse.text().catch(() => "");
    throw new ChecklistAiError(`AI วิเคราะห์ภาพล้มเหลว (${aiResponse.status})`, aiResponse.status, errText.slice(0, 500));
  }

  const aiJson = await aiResponse.json();
  const rawContent: string | undefined = aiJson?.choices?.[0]?.message?.content;
  if (!rawContent) {
    throw new ChecklistAiError("AI ไม่ได้ส่งผลลัพธ์กลับมา");
  }

  try {
    const parsed = JSON.parse(rawContent) as { results: AiItemResult[] };
    return parsed.results;
  } catch {
    throw new ChecklistAiError("แปลงผลลัพธ์จาก AI ไม่สำเร็จ");
  }
}
