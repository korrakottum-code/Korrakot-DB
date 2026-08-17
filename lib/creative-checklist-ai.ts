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

const IMAGE_FETCH_TIMEOUT_MS = 30_000;
const AI_FETCH_TIMEOUT_MS = 60_000;
const AI_RETRY_DELAY_MS = 2_000;

async function fetchImageAsBase64(imageUrl: string): Promise<{ base64: string; mimeType: string }> {
  let res: Response;
  try {
    res = await fetch(imageUrl, { signal: AbortSignal.timeout(IMAGE_FETCH_TIMEOUT_MS) });
  } catch (err) {
    throw new ChecklistAiError("ดาวน์โหลดรูปภาพไม่สำเร็จ", undefined, err instanceof Error ? err.message : undefined);
  }
  if (!res.ok) {
    throw new ChecklistAiError(`ดาวน์โหลดรูปภาพล้มเหลว (${res.status})`, res.status);
  }
  const contentType = res.headers.get("content-type") || "image/jpeg";
  const mimeType = contentType.split(";")[0].trim();
  const buffer = await res.arrayBuffer();
  const base64 = Buffer.from(buffer).toString("base64");
  return { base64, mimeType };
}

/** เรียก OpenAI พร้อม timeout; retry อัตโนมัติ 1 ครั้งเมื่อเจอ 429/5xx/network error */
async function callOpenAiWithRetry(apiKey: string, body: string): Promise<Response> {
  let lastError: ChecklistAiError | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, AI_RETRY_DELAY_MS));
    let res: Response;
    try {
      res = await fetch(OPENAI_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body,
        signal: AbortSignal.timeout(AI_FETCH_TIMEOUT_MS),
      });
    } catch (err) {
      lastError = new ChecklistAiError(
        "เรียก AI วิเคราะห์ภาพไม่สำเร็จ",
        undefined,
        err instanceof Error ? err.message : undefined
      );
      continue;
    }
    if (res.status === 429 || res.status >= 500) {
      const errText = await res.text().catch(() => "");
      lastError = new ChecklistAiError(`AI วิเคราะห์ภาพล้มเหลว (${res.status})`, res.status, errText.slice(0, 500));
      continue;
    }
    return res;
  }
  throw lastError ?? new ChecklistAiError("เรียก AI วิเคราะห์ภาพไม่สำเร็จ");
}

export async function scoreImageAgainstChecklist(
  apiKey: string,
  imageUrl: string,
  items: ChecklistItem[],
  mediaType: MediaType
): Promise<AiItemResult[]> {
  const { base64, mimeType } = await fetchImageAsBase64(imageUrl);
  const dataUri = `data:${mimeType};base64,${base64}`;

  const requestBody = JSON.stringify({
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
          { type: "image_url", image_url: { url: dataUri } },
        ],
      },
    ],
    response_format: { type: "json_schema", json_schema: buildChecklistJsonSchema(items.map((i) => i.id)) },
    max_tokens: 2000,
    // ภาพเดิมต้องได้ผลเดิม — คะแนนที่แกว่งไปมาทำให้ threshold และผลตรวจเชื่อถือไม่ได้
    temperature: 0,
  });

  const aiResponse = await callOpenAiWithRetry(apiKey, requestBody);

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
