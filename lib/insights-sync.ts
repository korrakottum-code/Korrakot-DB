import { fetchAdNames, fetchDailyMetrics, type AdAccount, type FetchFailure } from "./meta";
import {
  findMissingFinalRanges,
  getSyncMeta,
  isRecentWindowFresh,
  markSynced,
  recordSyncChangeStats,
  setSyncMeta,
  splitDateRange,
  upsertAdNames,
  upsertDailyMetrics,
  type AdNameRow,
  type DailyMetricRow,
} from "./insights-store";

/** ช่วง recent ที่ sync แล้วภายในเวลานี้ ไม่ต้องยิง Meta ซ้ำ — สลับ preset ไปมาจึงอ่านจาก DB ล้วน (ปุ่มรีเฟรชยังบังคับดึงใหม่ได้) */
export const RECENT_SYNC_MAX_AGE_MS = 10 * 60 * 1000;
// กวาดชื่อแอด "ทั้งหมด" (รวมแอดที่หยุดรันไปแล้ว) วันละครั้งพอ — ชื่อของแอดที่ยังใช้เงินอยู่
// อัปเดตติดมากับ fetch metrics ทุกรอบอยู่แล้ว รอบกวาดนี้มีไว้จับ rename ของแอดเก่าเท่านั้น
const AD_NAME_SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000;
const AD_NAME_SWEEP_META_KEY = "ad-names-full-sweep";

/** บัญชีที่ token นี้กวาดสำเร็จจริง (ตัดบัญชีที่ fetch พังออก) — ใช้เป็นรายชื่อที่ mark ว่า sync แล้ว */
function sweptAccountIds(accounts: AdAccount[], failures: FetchFailure[]): string[] {
  const failed = new Set(failures.map((f) => f.accountId).filter(Boolean));
  return accounts.map((a) => a.id).filter((id) => !failed.has(id));
}

function adNamesFromRows(rows: DailyMetricRow[]): AdNameRow[] {
  const byId = new Map<string, AdNameRow>();
  for (const row of rows) {
    if (!row.adName) continue;
    byId.set(row.adId, {
      adId: row.adId,
      accountId: row.accountId,
      adName: row.adName,
      campaignId: row.campaignId,
      adSetId: row.adSetId,
    });
  }
  return [...byId.values()];
}

/**
 * Fetches only the gaps in `finalDates` that aren't yet in the store (across
 * all given accounts, unioned into one bounding range per token — see
 * lib/insights-store.ts's header comment for why "final" days are safe to
 * cache forever). Shared by the live insights API route and the standalone
 * backfill script (scripts/backfill-insights.ts) so both stay in sync.
 */
export async function syncFinalDates(token: string, accountIds: string[], finalDates: string[]): Promise<FetchFailure[]> {
  if (finalDates.length === 0 || accountIds.length === 0) return [];

  const gapRanges = await findMissingFinalRanges(accountIds, finalDates);
  if (gapRanges.length === 0) return [];

  const gapSince = gapRanges[0].since;
  const gapUntil = gapRanges[gapRanges.length - 1].until;

  const { rows, accounts, failures } = await fetchDailyMetrics(token, gapSince, gapUntil);
  await upsertDailyMetrics(rows);
  await upsertAdNames(adNamesFromRows(rows));
  // mark เฉพาะบัญชีที่ token นี้กวาดสำเร็จจริง — บัญชีที่พังหรืออยู่กับ token อื่นยังถือว่าไม่ sync
  const gapDates = finalDates.filter((d) => d >= gapSince && d <= gapUntil);
  const swept = sweptAccountIds(accounts, failures);
  await Promise.all(swept.map((id) => markSynced(id, gapDates)));

  return failures;
}

/**
 * Refreshes the trailing "recent"/unsettled window — but only when it hasn't
 * been synced within RECENT_SYNC_MAX_AGE_MS (freshness lives in the DB keyed
 * by (account, date), so a sync triggered by one preset covers every preset).
 * Recent-day sync rows deliberately don't count as "final" — see
 * findMissingFinalRanges — so each day still gets one last fetch after it
 * settles.
 */
// กัน request ที่มาไล่เลี่ยกัน (เช่นหลาย preset สั่ง sync เบื้องหลังพร้อมกัน) กวาดช่วงเดียวกันซ้ำ —
// รอบที่วิ่งอยู่แชร์ promise เดียวกัน รอบถัดไปเจอ freshness ใน DB แล้วเป็น no-op เอง
const inFlightRecentSync = new Map<string, Promise<FetchFailure[]>>();

export async function syncRecentDates(
  token: string,
  accountIds: string[],
  recentDates: string[],
  forceRefresh = false
): Promise<FetchFailure[]> {
  if (recentDates.length === 0) return [];
  if (!forceRefresh && (await isRecentWindowFresh(accountIds, recentDates, RECENT_SYNC_MAX_AGE_MS))) return [];

  const since = recentDates[0];
  const until = recentDates[recentDates.length - 1];
  const flightKey = `${token.slice(-16)}:${since}:${until}`;
  const inFlight = inFlightRecentSync.get(flightKey);
  if (inFlight && !forceRefresh) return inFlight;

  const run = (async () => {
    const { rows, accounts, failures } = await fetchDailyMetrics(token, since, until);
    const swept = sweptAccountIds(accounts, failures);
    // เก็บสถิติ "วันอายุเท่านี้ยังเปลี่ยนจริงไหม" ก่อนทับของเก่า — ใช้เป็นหลักฐาน
    // หด SETTLING_WINDOW_DAYS ในอนาคต (ดูสรุป: npm run sync-change-stats)
    try {
      await recordSyncChangeStats(rows, swept, recentDates, new Date());
    } catch (err) {
      console.warn("[sync-change-stats] failed:", err instanceof Error ? err.message : err);
    }
    await upsertDailyMetrics(rows);
    await upsertAdNames(adNamesFromRows(rows));
    await Promise.all(swept.map((id) => markSynced(id, recentDates)));
    return failures;
  })();
  inFlightRecentSync.set(flightKey, run);
  try {
    return await run;
  } finally {
    if (inFlightRecentSync.get(flightKey) === run) inFlightRecentSync.delete(flightKey);
  }
}

/** sync ช่วงวันที่ที่ขอทั้งก้อน (final เฉพาะที่ยังไม่มี + recent ตาม freshness) สำหรับ 1 token */
export async function syncRange(
  token: string,
  accountIds: string[],
  since: string,
  until: string,
  asOf: Date,
  options: { forceRefresh?: boolean; skipRecent?: boolean } = {}
): Promise<FetchFailure[]> {
  const { finalDates, recentDates } = splitDateRange(since, until, asOf);
  return [
    ...(await syncFinalDates(token, accountIds, finalDates)),
    // skipRecent = โหมดเสิร์ฟก่อน: ช่วง recent มีข้อมูลครบแต่เก่า จะถูก sync เบื้องหลังแทน
    ...(options.skipRecent ? [] : await syncRecentDates(token, accountIds, recentDates, options.forceRefresh)),
  ];
}

/**
 * Full ad-name sweep (every ad, active or not) at most once per
 * AD_NAME_SWEEP_INTERVAL_MS across all processes — the timestamp lives in the
 * sync_meta table, not process memory, so serverless cold starts don't re-run
 * it. This is what keeps renames of long-inactive ads retroactively correct;
 * names of ads still spending ride along with every metrics fetch instead.
 */
export async function ensureDailyAdNameSweep(tokens: string[]): Promise<FetchFailure[]> {
  const last = await getSyncMeta(AD_NAME_SWEEP_META_KEY);
  if (last !== null && Date.now() - last < AD_NAME_SWEEP_INTERVAL_MS) return [];

  // จองรอบไว้ก่อนเริ่มกวาด กัน request อื่นที่เข้ามาระหว่างกวาด (~1 นาที) แห่กวาดซ้ำ
  await setSyncMeta(AD_NAME_SWEEP_META_KEY);

  const results = await Promise.all(tokens.map((token) => fetchAdNames(token)));
  await upsertAdNames(results.flatMap((r) => r.rows));
  const failures = results.flatMap((r) => r.failures);
  // รันเบื้องหลังหลังส่งคำตอบไปแล้ว — ไม่มีที่ให้แสดงบนหน้าเว็บ จึงบันทึกลง log ฝั่งเซิร์ฟเวอร์
  for (const f of failures) {
    console.warn(`[ad-name-sweep] ${f.accountName || f.accountId || f.scope}: ${f.message}`);
  }
  return failures;
}
