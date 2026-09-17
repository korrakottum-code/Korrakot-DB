/**
 * Read-only client for Pancake (pages.fm) — ใช้ประเมินความเร็วตอบแชทของแอดมินแต่ละสาขา
 * เทียบกับ Depth3 ของ Meta Ads (ดู lib/reporting.ts) — คนละแหล่งข้อมูล คนละ token
 *
 * PANCAKE_ACCESS_TOKEN เป็น session token ส่วนตัว (มีวันหมดอายุฝังอยู่ใน JWT) ไม่ใช่ API key
 * ถาวร — ถ้าหมดอายุ/ผู้ใช้ logout ที่อื่น endpoint พวกนี้จะเริ่มตอบ error ต้องขอ token ใหม่
 *
 * Pancake ไม่มี endpoint ให้ query ตามช่วงวันที่ตรงๆ — ดึงได้แค่ "บทสนทนาล่าสุด N รายการ"
 * (ยิ่ง limit สูง ยิ่งย้อนหลังได้ไกล) เลยดึงมาเป็นก้อนใหญ่ก้อนเดียว (แคชไว้ใน route) แล้วมา
 * กรองตามวันที่ (Asia/Bangkok) เอาเองฝั่งนี้ — สาขาที่คุยเยอะ ก้อนเดียวกันจะย้อนได้ไม่กี่วัน
 * ส่วนสาขาที่คุยน้อยจะย้อนได้ไกลกว่า ดู `oldestConversationAt` ต่อเพจเพื่อรู้ขอบเขตจริง
 */
import { fromZonedTime } from "date-fns-tz";

const PANCAKE_API_BASE = "https://pages.fm/api/v1";
const PANCAKE_TZ = "Asia/Bangkok";
/** จำนวนบทสนทนาล่าสุดที่ดึงต่อเพจ — สูงพอให้ครอบคลุมย้อนหลังหลายวันสำหรับสาขาส่วนใหญ่ โดยไม่หนักเกินไป */
const FETCH_LIMIT = 300;

/** เพจที่ชื่อขึ้นต้น/มีคำว่า Class Clinic หรือ Class Go เท่านั้น — ตัดเพจแบรนด์อื่นในเครือเดียวกันออก */
function isClassClinicPage(name: string): boolean {
  const n = name.toLowerCase();
  return (
    n.includes("class clinic") ||
    n.includes("class go") ||
    name.includes("คลาสคลินิก") ||
    name.includes("คลาสโก")
  );
}

export interface PancakePage {
  id: string;
  name: string;
  platform: string;
}

export interface PageResponseStats {
  pageId: string;
  name: string;
  conversationsFetched: number;
  withCustomerMsg: number;
  noStaffSeenYet: number;
  sampleWithGap: number;
  medianMinutes: number | null;
  avgMinutes: number | null;
  /** บทสนทนาที่เก่าที่สุดที่ดึงมาได้ของเพจนี้ — ถ้าวันที่เลือกเก่ากว่านี้ แปลว่าข้อมูลไม่ครบ */
  oldestConversationAt: string | null;
  /** true = ก้อนข้อมูลที่ดึงมาไม่ย้อนไปถึงต้นวันที่เลือก ตัวเลขวันนี้จึงอาจนับไม่ครบ */
  coverageIncomplete: boolean;
  error?: string;
}

/** ขอบเขต [since, until) ของวันปฏิทิน (Asia/Bangkok) หนึ่งวัน เป็น epoch ms แบบ UTC จริง */
export function bangkokDayRangeMs(dateStr: string): { sinceMs: number; untilMs: number } {
  const sinceMs = fromZonedTime(`${dateStr}T00:00:00`, PANCAKE_TZ).getTime();
  const untilMs = sinceMs + 24 * 60 * 60 * 1000;
  return { sinceMs, untilMs };
}

export function todayBangkokDateStr(): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: PANCAKE_TZ }).formatToParts(new Date());
  const y = parts.find((p) => p.type === "year")!.value;
  const m = parts.find((p) => p.type === "month")!.value;
  const d = parts.find((p) => p.type === "day")!.value;
  return `${y}-${m}-${d}`;
}

async function pancakeGet(path: string, token: string): Promise<unknown> {
  const url = `${PANCAKE_API_BASE}/${path}${path.includes("?") ? "&" : "?"}access_token=${token}`;
  const res = await fetch(url);
  const contentType = res.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    throw new Error(`Pancake ตอบไม่ใช่ JSON (HTTP ${res.status}) — token อาจหมดอายุ`);
  }
  const data = await res.json();
  if (data && data.success === false) {
    throw new Error(data.message || "Pancake API error");
  }
  return data;
}

export async function fetchClassClinicPages(token: string): Promise<PancakePage[]> {
  const data = (await pancakeGet("pages", token)) as {
    categorized?: { activated?: Array<{ id: string; name: string; platform: string }> };
  };
  const pages = data.categorized?.activated || [];
  return pages
    .filter((p) => isClassClinicPage(p.name || ""))
    .map((p) => ({ id: p.id, name: p.name, platform: p.platform }));
}

export interface PancakeConversation {
  last_customer_interactive_at?: string;
  recent_seen_users?: Array<{ seen_at: string }>;
}

/**
 * Pancake ส่ง timestamp มาแบบ "naive" (ไม่มี Z/offset ต่อท้าย เช่น "2026-09-17T03:53:00")
 * แต่ค่าจริงคือเวลา Bangkok local อยู่แล้ว — `new Date(iso)` เฉยๆ จะตีความตาม system timezone
 * ของเครื่องที่รันโค้ด: เครื่อง dev ที่ตั้งเวลาไทยไว้จะได้ผลถูกโดยบังเอิญ แต่ serverless ของ Vercel
 * default เป็น UTC ทำให้ทุก timestamp เพี้ยนไป 7 ชั่วโมง (พังทั้งการกรองวันและคำนวณ gap เป็นทอดๆ)
 * ต้องบังคับตีความเป็น Bangkok เสมอไม่ว่าจะรันที่ไหน
 */
function parsePancakeTime(iso: string): number {
  return fromZonedTime(iso, PANCAKE_TZ).getTime();
}

/** ตัด outlier เกิน 3 วัน (บทสนทนาเก่าที่เพิ่งมีคนเปิดดู ไม่ใช่ตอบช้าจริง) */
export const MAX_GAP_MINUTES = 60 * 24 * 3;

export function computeStats(
  pageId: string,
  name: string,
  conversations: PancakeConversation[],
  dayRangeMs?: { sinceMs: number; untilMs: number }
): PageResponseStats {
  const inDay = (iso: string) => {
    if (!dayRangeMs) return true;
    const t = parsePancakeTime(iso);
    return t >= dayRangeMs.sinceMs && t < dayRangeMs.untilMs;
  };

  const gaps: number[] = [];
  let withCustomerMsg = 0;
  let noStaffSeenYet = 0;
  let oldest: number | null = null;

  for (const c of conversations) {
    const lastCustomer = c.last_customer_interactive_at;
    if (!lastCustomer) continue;
    const lastCustomerMs = parsePancakeTime(lastCustomer);
    oldest = oldest === null ? lastCustomerMs : Math.min(oldest, lastCustomerMs);
    if (!inDay(lastCustomer)) continue;

    withCustomerMsg++;
    const seenAfter = (c.recent_seen_users || [])
      .map((u) => parsePancakeTime(u.seen_at))
      .filter((t) => t >= lastCustomerMs);
    if (seenAfter.length === 0) {
      noStaffSeenYet++;
      continue;
    }
    const gapMin = (Math.min(...seenAfter) - lastCustomerMs) / 60_000;
    if (gapMin >= 0 && gapMin < MAX_GAP_MINUTES) gaps.push(gapMin);
  }

  gaps.sort((a, b) => a - b);
  const median = gaps.length ? gaps[Math.floor(gaps.length / 2)] : null;
  const avg = gaps.length ? gaps.reduce((s, v) => s + v, 0) / gaps.length : null;

  return {
    pageId,
    name,
    conversationsFetched: conversations.length,
    withCustomerMsg,
    noStaffSeenYet,
    sampleWithGap: gaps.length,
    medianMinutes: median !== null ? Math.round(median * 10) / 10 : null,
    avgMinutes: avg !== null ? Math.round(avg * 10) / 10 : null,
    oldestConversationAt: oldest !== null ? new Date(oldest).toISOString() : null,
    coverageIncomplete: dayRangeMs !== undefined && (oldest === null || oldest > dayRangeMs.sinceMs),
  };
}

interface RawPageConversations {
  pageId: string;
  name: string;
  conversations: PancakeConversation[];
  error?: string;
}

async function fetchPageConversations(page: PancakePage, token: string): Promise<RawPageConversations> {
  try {
    const data = (await pancakeGet(`pages/${page.id}/conversations?limit=${FETCH_LIMIT}`, token)) as {
      conversations?: PancakeConversation[];
    };
    return { pageId: page.id, name: page.name, conversations: data.conversations || [] };
  } catch (err) {
    return { pageId: page.id, name: page.name, conversations: [], error: err instanceof Error ? err.message : "unknown error" };
  }
}

const CONCURRENCY = 5;

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * ดึงบทสนทนาล่าสุดของทุกเพจ Class Clinic/Class Go เป็นก้อนดิบ — ไม่กรองวันที่
 * ให้ผู้เรียก (route) แคชก้อนนี้ไว้ แล้วเรียก statsForDay ซ้ำได้หลายวันที่โดยไม่ต้องยิง Pancake ใหม่
 */
export async function fetchAllPagesConversations(token: string): Promise<RawPageConversations[]> {
  const pages = await fetchClassClinicPages(token);
  return mapWithConcurrency(pages, CONCURRENCY, (p) => fetchPageConversations(p, token));
}

/** คำนวณสถิติของทุกเพจสำหรับวันที่ระบุ (Asia/Bangkok) จากก้อนข้อมูลดิบที่ fetchAllPagesConversations ดึงมา */
export function statsForDay(raw: RawPageConversations[], dateStr: string): PageResponseStats[] {
  const dayRangeMs = bangkokDayRangeMs(dateStr);
  const stats = raw.map((r) => {
    const s = computeStats(r.pageId, r.name, r.conversations, dayRangeMs);
    return r.error ? { ...s, error: r.error } : s;
  });
  return stats.sort((a, b) => (b.medianMinutes ?? -1) - (a.medianMinutes ?? -1));
}
