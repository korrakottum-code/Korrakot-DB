/**
 * เก็บ pancake_response_events แบบถาวรลง Postgres เดียวกับที่ ad_daily_metrics ใช้ (getSharedPool)
 * — ดู data/migrations/011_pancake_response_events.sql สำหรับ schema และเหตุผลที่ต้องมีตารางนี้
 */
import { getSharedPool } from "./insights-store";
import { fetchAllPagesConversations, extractResponseEvents, type ResponseEvent } from "./pancake";

const UPSERT_BATCH_SIZE = 500;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export async function upsertResponseEvents(events: ResponseEvent[]): Promise<void> {
  if (events.length === 0) return;
  const db = getSharedPool();
  for (const batch of chunk(events, UPSERT_BATCH_SIZE)) {
    const values: unknown[] = [];
    const placeholders = batch.map((e, i) => {
      const base = i * 8;
      values.push(e.pageId, e.pageName, e.conversationId, e.adminId, e.adminName, e.gapMinutes, e.customerMessageAt, e.respondedAt);
      const ph = Array.from({ length: 8 }, (_, j) => `$${base + j + 1}`);
      return `(${ph.join(",")}, now())`;
    });
    await db.query(
      `insert into pancake_response_events
         (page_id, page_name, conversation_id, admin_id, admin_name, gap_minutes, customer_message_at, responded_at, synced_at)
       values ${placeholders.join(",")}
       on conflict (page_id, conversation_id) do update set
         page_name = excluded.page_name,
         admin_id = excluded.admin_id,
         admin_name = excluded.admin_name,
         gap_minutes = excluded.gap_minutes,
         customer_message_at = excluded.customer_message_at,
         responded_at = excluded.responded_at,
         synced_at = excluded.synced_at`,
      values
    );
  }
}

export interface PancakeSyncResult {
  pagesOk: number;
  pagesFailed: { pageId: string; name: string; message: string }[];
  eventsUpserted: number;
}

/** ดึงบทสนทนาล่าสุดของทุกเพจ Class Clinic/Class Go แล้วเก็บเหตุการณ์ตอบแชทลง DB ถาวร — เรียกจาก cron route และ script */
export async function syncAllPancakeEvents(token: string): Promise<PancakeSyncResult> {
  const raw = await fetchAllPagesConversations(token);

  const allEvents: ResponseEvent[] = [];
  const pagesFailed: PancakeSyncResult["pagesFailed"] = [];
  for (const page of raw) {
    if (page.error) {
      pagesFailed.push({ pageId: page.pageId, name: page.name, message: page.error });
      continue;
    }
    allEvents.push(...extractResponseEvents(page.pageId, page.name, page.conversations));
  }

  await upsertResponseEvents(allEvents);

  return {
    pagesOk: raw.length - pagesFailed.length,
    pagesFailed,
    eventsUpserted: allEvents.length,
  };
}
