/**
 * เก็บ pancake_response_events แบบถาวรลง Postgres เดียวกับที่ ad_daily_metrics ใช้ (getSharedPool)
 * — ดู data/migrations/011_pancake_response_events.sql สำหรับ schema และเหตุผลที่ต้องมีตารางนี้
 *
 * ตารางนี้เป็นแหล่งข้อมูลเดียวที่ /admin ใช้อ่านสถิติ (ไม่ดึงสดจาก Pancake อีกต่อไป) เพราะ Pancake
 * เองให้ดึงย้อนหลังได้แค่ "บทสนทนาล่าสุด N รายการ" เท่านั้น ไม่มีทาง query ตามช่วงวันที่จริงๆ —
 * ช่วงที่ไกลกว่าวันนี้ (เช่น "เดือนที่แล้ว") จึงต้องพึ่งข้อมูลที่ sync เก็บสะสมไว้ล่วงหน้าเท่านั้น
 *
 * ข้อจำกัด: ตาราง events เก็บเฉพาะบทสนทนาที่ "ตอบแล้ว" (ดู extractResponseEvents) สถิติที่อ่านจาก
 * DB จึงมีแค่ count/median/avg ของการตอบ ไม่มี "ยังไม่มีคนดู" ย้อนหลังเหมือนตอนดึงสดแบบเดิม
 */
import { getSharedPool } from "./insights-store";
import { fetchAllPagesConversations, extractResponseEvents, bangkokRangeMs, type ResponseEvent } from "./pancake";

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

export interface DbPageStats {
  pageId: string;
  name: string;
  count: number;
  medianMinutes: number | null;
  avgMinutes: number | null;
}

export interface DbAdminStats {
  adminId: string;
  adminName: string;
  count: number;
  medianMinutes: number | null;
  avgMinutes: number | null;
}

/** สถิติรายสาขาจากข้อมูลที่ sync เก็บไว้ใน DB (ไม่ใช่ดึงสดจาก Pancake) — ใช้ percentile_cont หา median จริง */
export async function readPageStatsForRange(since: string, until: string): Promise<DbPageStats[]> {
  const db = getSharedPool();
  const { sinceMs, untilMs } = bangkokRangeMs(since, until);
  const { rows } = await db.query<{ pageId: string; name: string; count: string; medianMinutes: string | null; avgMinutes: string | null }>(
    `select
       page_id as "pageId",
       page_name as "name",
       count(*)::int::text as count,
       percentile_cont(0.5) within group (order by gap_minutes) as "medianMinutes",
       avg(gap_minutes) as "avgMinutes"
     from pancake_response_events
     where customer_message_at >= $1 and customer_message_at < $2
     group by page_id, page_name`,
    [new Date(sinceMs), new Date(untilMs)]
  );
  return rows
    .map((r) => ({
      pageId: r.pageId,
      name: r.name,
      count: Number(r.count),
      medianMinutes: r.medianMinutes !== null ? Math.round(Number(r.medianMinutes) * 10) / 10 : null,
      avgMinutes: r.avgMinutes !== null ? Math.round(Number(r.avgMinutes) * 10) / 10 : null,
    }))
    .sort((a, b) => (b.medianMinutes ?? -1) - (a.medianMinutes ?? -1));
}

/** สถิติรายแอดมินจากข้อมูลที่ sync เก็บไว้ใน DB — รวมทุกเพจในเครือ เหมือน statsByAdminForDateRange แต่อ่านจาก DB */
export async function readAdminStatsForRange(since: string, until: string): Promise<DbAdminStats[]> {
  const db = getSharedPool();
  const { sinceMs, untilMs } = bangkokRangeMs(since, until);
  const { rows } = await db.query<{ adminId: string; adminName: string; count: string; medianMinutes: string | null; avgMinutes: string | null }>(
    `select
       admin_id as "adminId",
       admin_name as "adminName",
       count(*)::int::text as count,
       percentile_cont(0.5) within group (order by gap_minutes) as "medianMinutes",
       avg(gap_minutes) as "avgMinutes"
     from pancake_response_events
     where customer_message_at >= $1 and customer_message_at < $2
     group by admin_id, admin_name`,
    [new Date(sinceMs), new Date(untilMs)]
  );
  return rows
    .map((r) => ({
      adminId: r.adminId,
      adminName: r.adminName,
      count: Number(r.count),
      medianMinutes: r.medianMinutes !== null ? Math.round(Number(r.medianMinutes) * 10) / 10 : null,
      avgMinutes: r.avgMinutes !== null ? Math.round(Number(r.avgMinutes) * 10) / 10 : null,
    }))
    .sort((a, b) => (b.medianMinutes ?? -1) - (a.medianMinutes ?? -1));
}

/** เวลาที่ sync ล่าสุดสำเร็จ (ทุกเพจรวมกัน) — ใช้บอกความสดของข้อมูลใน UI */
export async function readLastSyncedAt(): Promise<string | null> {
  const db = getSharedPool();
  const { rows } = await db.query<{ lastSyncedAt: Date | null }>(
    `select max(synced_at) as "lastSyncedAt" from pancake_response_events`
  );
  const v = rows[0]?.lastSyncedAt;
  return v ? new Date(v).toISOString() : null;
}
