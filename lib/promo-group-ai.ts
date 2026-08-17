import { fetchImageAsBase64, ChecklistAiError } from "./creative-checklist-ai";

/**
 * ให้ AI อ่านราคา/โปรโมชั่นจากรูปครีเอทีฟแทนการพิมพ์เอง — ราคาไม่ได้อยู่ในชื่อแอด
 * (ดู lib/creative-promo-store.ts) แต่มักพิมพ์ไว้เด่นในตัวภาพ เช่น "filler 2990"
 * ผู้ใช้แค่เปิดช่องติดแท็ก ระบบเดาให้ แล้วกดยืนยันได้เลยถ้าถูกต้อง
 */

const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";

export interface PromoGroupSuggestion {
  /** ตัวเลขราคาล้วนๆ พร้อมใช้เป็นแท็กได้ทันที เช่น "2990" — ว่างถ้าไม่เห็นราคาชัดเจนในภาพ */
  promoGroup: string;
  /** ข้อความราคาที่ AI เห็นจริงในภาพ ไว้ให้ผู้ใช้เทียบก่อนกดยืนยัน */
  foundText: string;
}

function buildPromoSuggestionSchema() {
  return {
    name: "promo_group_suggestion",
    strict: true,
    schema: {
      type: "object",
      properties: {
        foundText: {
          type: "string",
          description: "ข้อความราคา/โปรโมชั่นที่เห็นจริงในภาพ (คัดลอกตามที่เห็น) — ค่าว่างถ้าไม่มี",
        },
        promoGroup: {
          type: "string",
          description:
            "ตัวเลขราคาเด่นที่สุดในภาพ ล้วนตัวเลขเท่านั้น ไม่มีจุลภาค/บาท/เครื่องหมายอื่น เช่น 2990 — ค่าว่างถ้าไม่เห็นราคาที่ชัดเจน อย่าเดาถ้าไม่มีหลักฐานในภาพ",
        },
      },
      required: ["foundText", "promoGroup"],
      additionalProperties: false,
    },
  };
}

export async function suggestPromoGroup(apiKey: string, imageUrl: string): Promise<PromoGroupSuggestion> {
  const { base64, mimeType } = await fetchImageAsBase64(imageUrl);
  const dataUri = `data:${mimeType};base64,${base64}`;

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
              "คุณช่วยอ่านราคา/โปรโมชั่นที่แสดงในภาพโฆษณาคลินิกเสริมความงามไทย ตอบเป็น JSON ตามสคีมาที่กำหนดเท่านั้น",
          },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "ดูตัวเลขราคาโปรโมชั่นที่เด่นที่สุดในภาพนี้ (ตัวใหญ่สุด/ชัดสุด) แล้วตอบเฉพาะตัวเลข ถ้าไม่เห็นราคาที่ชัดเจนในภาพจริงให้ตอบค่าว่าง อย่าเดา",
              },
              { type: "image_url", image_url: { url: dataUri } },
            ],
          },
        ],
        response_format: { type: "json_schema", json_schema: buildPromoSuggestionSchema() },
        max_tokens: 300,
        temperature: 0,
      }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    throw new ChecklistAiError("เรียก AI เดาราคาไม่สำเร็จ", undefined, err instanceof Error ? err.message : undefined);
  }

  if (!aiResponse.ok) {
    const errText = await aiResponse.text().catch(() => "");
    throw new ChecklistAiError(`AI เดาราคาล้มเหลว (${aiResponse.status})`, aiResponse.status, errText.slice(0, 500));
  }

  const aiJson = await aiResponse.json();
  const rawContent: string | undefined = aiJson?.choices?.[0]?.message?.content;
  if (!rawContent) {
    throw new ChecklistAiError("AI ไม่ได้ส่งผลลัพธ์กลับมา");
  }

  try {
    const parsed = JSON.parse(rawContent) as PromoGroupSuggestion;
    return { promoGroup: (parsed.promoGroup || "").trim(), foundText: (parsed.foundText || "").trim() };
  } catch {
    throw new ChecklistAiError("แปลงผลลัพธ์จาก AI ไม่สำเร็จ");
  }
}
