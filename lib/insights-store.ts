import { Pool } from "pg";
import { toZonedTime } from "date-fns-tz";
import { REPORTING_TIMEZONE } from "./reporting";

/**
 * Persistent, incremental cache for Meta Ads daily insights.
 *
 * Meta's attribution windows (7-day click / 1-day view) mean a day's numbers
 * can still shift for about a week after it happens, so dates are split into:
 *   - "final" (older than SETTLING_WINDOW_DAYS): fetched from Meta once, then
 *     never touched again — read straight out of Postgres forever after.
 *   - "recent" (within the window): always re-fetched from Meta so numbers
 *     self-heal as attribution settles.
 *
 * Ad names are deliberately NOT stored alongside daily metrics — Meta's
 * insights API always returns an ad's *current* name regardless of which
 * historical day is being queried, so baking a name into a permanently-final
 * row would leave renamed ads mis-attributed forever. Instead, current names
 * live in ad_name_cache (refreshed often) and are joined at read time via
 * readInsightRows, so a rename retroactively reclassifies all historical
 * spend for that ad on the next read.
 */

export const SETTLING_WINDOW_DAYS = 7;
/** หน้าต่างแคบสุดที่ยอมให้ระบบหดเองได้ — เมื่อวานต้องถูก sync ซ้ำเสมอ */
export const MIN_SETTLING_WINDOW_DAYS = 2;
/** ต้องสังเกตอย่างน้อยเท่านี้ต่อช่วงอายุ (~29 บัญชี × ~10 รอบ sync) ก่อนกล้าตัดสิน */
const WINDOW_MIN_OBSERVATIONS = 300;
/** อัตราการเปลี่ยนสูงสุดที่ยังถือว่า "นิ่งแล้ว" */
const WINDOW_MAX_CHANGE_RATE = 0.01;
const UPSERT_BATCH_SIZE = 500;

function parseDateUTC(value: string): Date {
  const [y, m, d] = value.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function formatDateUTC(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDaysUTC(dateStr: string, days: number): string {
  return formatDateUTC(new Date(parseDateUTC(dateStr).getTime() + days * 86_400_000));
}

function enumerateDates(since: string, until: string): string[] {
  const dates: string[] = [];
  let cur = parseDateUTC(since).getTime();
  const end = parseDateUTC(until).getTime();
  while (cur <= end) {
    dates.push(formatDateUTC(new Date(cur)));
    cur += 86_400_000;
  }
  return dates;
}

export interface DateRangeSplit {
  finalDates: string[];
  recentDates: string[];
}

/** Dates strictly older than (asOf - settlingWindowDays) are "final"; the rest are "recent". */
export function splitDateRange(
  since: string,
  until: string,
  asOf: Date,
  settlingWindowDays: number = SETTLING_WINDOW_DAYS
): DateRangeSplit {
  const todayUTC = formatDateUTC(new Date(Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), asOf.getUTCDate())));
  const boundary = addDaysUTC(todayUTC, -settlingWindowDays);
  const allDates = enumerateDates(since, until);
  return {
    finalDates: allDates.filter((d) => d < boundary),
    recentDates: allDates.filter((d) => d >= boundary),
  };
}

export interface DateRange {
  since: string;
  until: string;
}

/** Collapses a sorted list of missing dates into contiguous [since, until] runs, so a cold backfill is one Meta call per gap, not one per day. */
export function collapseToRanges(sortedDates: string[]): DateRange[] {
  if (sortedDates.length === 0) return [];
  const ranges: DateRange[] = [];
  let rangeStart = sortedDates[0];
  let rangeEnd = sortedDates[0];
  for (let i = 1; i < sortedDates.length; i++) {
    const d = sortedDates[i];
    if (d === addDaysUTC(rangeEnd, 1)) {
      rangeEnd = d;
    } else {
      ranges.push({ since: rangeStart, until: rangeEnd });
      rangeStart = d;
      rangeEnd = d;
    }
  }
  ranges.push({ since: rangeStart, until: rangeEnd });
  return ranges;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

let pool: Pool | null = null;

/** Pool กลางของแอป — ให้ store อื่น (เช่น parser-config-store) ใช้ connection เดียวกัน */
export function getSharedPool(): Pool {
  return getPool();
}

function getPool(): Pool {
  if (!pool) {
    const connectionString = process.env.POSTGRES_URL;
    if (!connectionString) {
      throw new Error("POSTGRES_URL is not set — add it to .env.local (see README.md)");
    }
    // Vercel Postgres / Neon require SSL; rejectUnauthorized:false matches Vercel's own pg setup docs.
    pool = new Pool({ connectionString, ssl: { rejectUnauthorized: false } });
  }
  return pool;
}

export interface DailyMetricRow {
  accountId: string;
  adId: string;
  date: string;
  campaignId?: string;
  adSetId?: string;
  spend: number;
  impressions: number;
  clicks: number;
  reach: number;
  inbox: number;
  leads: number;
  /** ชื่อแอด ณ เวลาที่ fetch — ไม่ถูกเก็บลง ad_daily_metrics แต่ใช้อัปเดต ad_name_cache แบบติดสอยห้อยตาม (ไม่ต้องยิง Meta เพิ่ม) */
  adName?: string;
}

export interface AdNameRow {
  adId: string;
  accountId: string;
  adName: string;
  campaignId?: string;
  adSetId?: string;
}

export interface StoredInsightRow {
  accountId: string;
  adId: string;
  adName: string;
  date: string;
  campaignId: string;
  adSetId: string;
  spend: number;
  impressions: number;
  clicks: number;
  reach: number;
  inbox: number;
  leads: number;
}

/**
 * Which of the given "final" dates are missing for ANY of the accounts,
 * collapsed into contiguous ranges (one bulk query, not one per account).
 *
 * A sync row only counts if it happened AFTER the date aged past the settling
 * window (synced_at ≥ date + settling + 1 day) — a row synced while the date
 * was still "recent" holds numbers Meta could since have adjusted, so the date
 * must be fetched once more after it becomes final.
 */
export async function findMissingFinalRanges(
  accountIds: string[],
  finalDates: string[],
  settlingWindowDays: number = SETTLING_WINDOW_DAYS
): Promise<DateRange[]> {
  if (finalDates.length === 0 || accountIds.length === 0) return [];
  const { rows } = await getPool().query<{ accountId: string; date: string }>(
    `select account_id as "accountId", date::text as date
     from ad_sync_progress
     where account_id = any($1::text[]) and date = any($2::date[])
       and synced_at >= date + interval '1 day' * $3`,
    [accountIds, finalDates, settlingWindowDays + 1]
  );
  const synced = new Set(rows.map((r) => `${r.accountId}|${r.date}`));
  const missing = new Set<string>();
  for (const accountId of accountIds) {
    for (const d of finalDates) {
      if (!synced.has(`${accountId}|${d}`)) missing.add(d);
    }
  }
  return collapseToRanges([...missing].sort());
}

export interface RecentWindowState {
  /** ทุกคู่ (account, date) เคยถูก sync แล้ว — เสิร์ฟจาก DB ได้เลยแม้จะเก่า */
  covered: boolean;
  /** ทุกคู่ถูก sync ภายใน maxAgeMs — ไม่ต้องยิง Meta ซ้ำ */
  fresh: boolean;
}

/** สถานะความสดของช่วง recent ในคำถามเดียว — covered ใช้ตัดสินว่าเสิร์ฟก่อนแล้วค่อย sync เบื้องหลังได้ไหม */
export async function recentWindowState(accountIds: string[], recentDates: string[], maxAgeMs: number): Promise<RecentWindowState> {
  if (recentDates.length === 0 || accountIds.length === 0) return { covered: true, fresh: true };
  const { rows } = await getPool().query<{ covered: number; fresh: number }>(
    `select count(*)::int as covered,
            (count(*) filter (where synced_at > now() - interval '1 millisecond' * $3))::int as fresh
     from ad_sync_progress
     where account_id = any($1::text[]) and date = any($2::date[])`,
    [accountIds, recentDates, maxAgeMs]
  );
  const total = accountIds.length * recentDates.length;
  return { covered: rows[0].covered === total, fresh: rows[0].fresh === total };
}

/** true เมื่อทุกคู่ (account, date) ของช่วง recent ถูก sync ภายใน maxAgeMs — ใช้ข้ามการยิง Meta ซ้ำเมื่อสลับ preset */
export async function isRecentWindowFresh(accountIds: string[], recentDates: string[], maxAgeMs: number): Promise<boolean> {
  return (await recentWindowState(accountIds, recentDates, maxAgeMs)).fresh;
}

export interface DailyAggregate {
  rowCount: number;
  spend: number;
  impressions: number;
  clicks: number;
  reach: number;
  inbox: number;
  leads: number;
}

/** รวมยอดต่อ (บัญชี, วัน) — คีย์ `${accountId}|${date}` */
export function aggregateByAccountDate(rows: DailyMetricRow[]): Map<string, DailyAggregate> {
  const map = new Map<string, DailyAggregate>();
  for (const row of rows) {
    const key = `${row.accountId}|${row.date}`;
    const agg = map.get(key) || { rowCount: 0, spend: 0, impressions: 0, clicks: 0, reach: 0, inbox: 0, leads: 0 };
    agg.rowCount += 1;
    agg.spend += row.spend;
    agg.impressions += row.impressions;
    agg.clicks += row.clicks;
    agg.reach += row.reach;
    agg.inbox += row.inbox;
    agg.leads += row.leads;
    map.set(key, agg);
  }
  return map;
}

/** ยอดรวมสองฝั่งต่างกันจริงไหม (ไม่มีข้อมูล = ศูนย์ทั้งชุด, spend เทียบด้วย epsilon กัน float เพี้ยน) */
export function aggregatesDiffer(a: DailyAggregate | undefined, b: DailyAggregate | undefined): boolean {
  const zero: DailyAggregate = { rowCount: 0, spend: 0, impressions: 0, clicks: 0, reach: 0, inbox: 0, leads: 0 };
  const left = a || zero;
  const right = b || zero;
  return (
    left.rowCount !== right.rowCount ||
    Math.abs(left.spend - right.spend) > 0.01 ||
    left.impressions !== right.impressions ||
    left.clicks !== right.clicks ||
    left.reach !== right.reach ||
    left.inbox !== right.inbox ||
    left.leads !== right.leads
  );
}

/**
 * บันทึกสถิติ "วันอายุ N วัน ตัวเลขยังเปลี่ยนจริงไหม" ก่อน upsert ทับช่วง recent —
 * นับเฉพาะคู่ (บัญชี, วัน) ที่เคย sync แล้ว (ครั้งแรกไม่ใช่หลักฐานการเปลี่ยน)
 * ต้องเรียกก่อน upsertDailyMetrics ไม่งั้นของเก่าถูกทับหายก่อนได้เทียบ
 */
export async function recordSyncChangeStats(
  fetchedRows: DailyMetricRow[],
  accountIds: string[],
  dates: string[],
  asOf: Date
): Promise<void> {
  if (dates.length === 0 || accountIds.length === 0) return;
  const db = getPool();

  const { rows: markedRows } = await db.query<{ accountId: string; date: string }>(
    `select account_id as "accountId", date::text as date from ad_sync_progress
     where account_id = any($1::text[]) and date = any($2::date[])`,
    [accountIds, dates]
  );
  if (markedRows.length === 0) return;

  const { rows: storedRows } = await db.query<{
    accountId: string; date: string; rowCount: number;
    spend: number; impressions: number; clicks: number; reach: number; inbox: number; leads: number;
  }>(
    `select account_id as "accountId", date::text as date, count(*)::int as "rowCount",
            coalesce(sum(spend), 0)::float8 as spend,
            coalesce(sum(impressions), 0)::float8 as impressions,
            coalesce(sum(clicks), 0)::float8 as clicks,
            coalesce(sum(reach), 0)::float8 as reach,
            coalesce(sum(inbox), 0)::float8 as inbox,
            coalesce(sum(leads), 0)::float8 as leads
     from ad_daily_metrics
     where account_id = any($1::text[]) and date = any($2::date[])
     group by account_id, date`,
    [accountIds, dates]
  );
  const storedByKey = new Map<string, DailyAggregate>(
    storedRows.map((r) => [`${r.accountId}|${r.date}`, {
      rowCount: r.rowCount, spend: r.spend, impressions: r.impressions,
      clicks: r.clicks, reach: r.reach, inbox: r.inbox, leads: r.leads,
    }])
  );
  const fetchedByKey = aggregateByAccountDate(fetchedRows);

  // อายุวันคิดตามเขตเวลารายงาน (Asia/Bangkok) — ถ้าใช้ UTC ช่วงเที่ยงคืน-เจ็ดโมงเช้าไทย
  // เมื่อวานจะถูกนับเป็นอายุ 0 ปนกับวันนี้
  const zoned = toZonedTime(asOf, REPORTING_TIMEZONE);
  const todayMs = Date.UTC(zoned.getFullYear(), zoned.getMonth(), zoned.getDate());
  const observedByAge = new Map<number, { observed: number; changed: number }>();
  for (const pair of markedRows) {
    const age = Math.max(0, Math.round((todayMs - parseDateUTC(pair.date).getTime()) / 86_400_000));
    const key = `${pair.accountId}|${pair.date}`;
    const bucket = observedByAge.get(age) || { observed: 0, changed: 0 };
    bucket.observed += 1;
    if (aggregatesDiffer(storedByKey.get(key), fetchedByKey.get(key))) bucket.changed += 1;
    observedByAge.set(age, bucket);
  }
  if (observedByAge.size === 0) return;

  const values: unknown[] = [];
  const placeholders = [...observedByAge.entries()].map(([age, b], i) => {
    values.push(age, b.observed, b.changed);
    return `($${i * 3 + 1}, $${i * 3 + 2}, $${i * 3 + 3}, now())`;
  });
  await db.query(
    `insert into sync_change_stats (age_days, observed, changed, last_observed_at)
     values ${placeholders.join(",")}
     on conflict (age_days) do update set
       observed = sync_change_stats.observed + excluded.observed,
       changed = sync_change_stats.changed + excluded.changed,
       last_observed_at = now()`,
    values
  );
}

export interface AgeChangeStat {
  ageDays: number;
  observed: number;
  changed: number;
}

/**
 * เลือกหน้าต่าง settling ที่แคบสุดที่ปลอดภัยจากสถิติจริง: N ต่ำสุดที่ทุกช่วงอายุ
 * ตั้งแต่ N ถึงเพดาน มีการสังเกตมากพอและอัตราเปลี่ยน ≤ เกณฑ์ — ข้อมูลไม่พอ = คงเพดานไว้
 */
export function pickSettlingWindow(
  stats: AgeChangeStat[],
  options: { min?: number; max?: number; minObserved?: number; maxChangeRate?: number } = {}
): number {
  const min = options.min ?? MIN_SETTLING_WINDOW_DAYS;
  const max = options.max ?? SETTLING_WINDOW_DAYS;
  const minObserved = options.minObserved ?? WINDOW_MIN_OBSERVATIONS;
  const maxChangeRate = options.maxChangeRate ?? WINDOW_MAX_CHANGE_RATE;

  const byAge = new Map(stats.map((s) => [s.ageDays, s]));
  for (let candidate = min; candidate < max; candidate++) {
    let allStable = true;
    for (let age = candidate; age <= max; age++) {
      const s = byAge.get(age);
      if (!s || s.observed < minObserved || s.changed / s.observed > maxChangeRate) {
        allStable = false;
        break;
      }
    }
    if (allStable) return candidate;
  }
  return max;
}

let effectiveWindowCache: { value: number; expiresAt: number } | null = null;
const EFFECTIVE_WINDOW_CACHE_MS = 60 * 60 * 1000;

/**
 * หน้าต่าง settling ที่ใช้จริง — ระบบทบทวนจากสถิติเองชั่วโมงละครั้ง ไม่ต้องมีคนมาปรับ
 * และ self-healing: การ fetch รอบสุดท้ายตอนวันข้ามพ้นหน้าต่างยังเก็บสถิติที่ขอบต่อเนื่อง
 * ถ้าตัวเลขที่ขอบกลับมาขยับบ่อย หน้าต่างจะขยายกลับเป็นค่าเพดานเอง
 */
export async function getEffectiveSettlingWindow(): Promise<number> {
  if (effectiveWindowCache && effectiveWindowCache.expiresAt > Date.now()) {
    return effectiveWindowCache.value;
  }
  let value = SETTLING_WINDOW_DAYS;
  try {
    const { rows } = await getPool().query<{ ageDays: number; observed: string; changed: string }>(
      `select age_days as "ageDays", observed::text, changed::text from sync_change_stats
       where age_days between $1 and $2`,
      [MIN_SETTLING_WINDOW_DAYS, SETTLING_WINDOW_DAYS]
    );
    value = pickSettlingWindow(
      rows.map((r) => ({ ageDays: r.ageDays, observed: Number(r.observed), changed: Number(r.changed) }))
    );
  } catch {
    // อ่านสถิติไม่ได้ → ใช้ค่าเพดานปลอดภัยไว้ก่อน
  }
  effectiveWindowCache = { value, expiresAt: Date.now() + EFFECTIVE_WINDOW_CACHE_MS };
  return value;
}

export interface SyncErrorEntry {
  occurredAt: string;
  source: string;
  accountId: string | null;
  accountName: string | null;
  message: string;
}

const ERROR_LOG_RETENTION_DAYS = 30;

/**
 * บันทึก error จากงานเบื้องหลังลง DB — ห้าม throw เด็ดขาดเพราะถูกเรียกใน error path
 * (ถ้า DB เองล่มก็ได้แค่ลง console) และแอบลบของเก่าเกิน 30 วันเป็นครั้งคราว
 */
export async function logSyncError(
  source: string,
  message: string,
  context: { accountId?: string; accountName?: string } = {}
): Promise<void> {
  try {
    await getPool().query(
      `insert into sync_error_log (source, account_id, account_name, message) values ($1, $2, $3, $4)`,
      [source, context.accountId || null, context.accountName || null, message.slice(0, 2000)]
    );
    if (Math.random() < 0.02) {
      await getPool().query(
        `delete from sync_error_log where occurred_at < now() - interval '1 day' * $1`,
        [ERROR_LOG_RETENTION_DAYS]
      );
    }
  } catch (err) {
    console.warn(`[sync-error-log] could not persist error (${source}: ${message}):`, err instanceof Error ? err.message : err);
  }
}

/** บันทึก failure รายบัญชีจากการดึง Meta เป็นชุด */
export async function logSyncFailures(
  source: string,
  failures: Array<{ accountId?: string; accountName?: string; message: string }>
): Promise<void> {
  for (const failure of failures) {
    await logSyncError(source, failure.message, { accountId: failure.accountId, accountName: failure.accountName });
  }
}

export async function readSyncErrors(limit = 100): Promise<SyncErrorEntry[]> {
  const { rows } = await getPool().query<SyncErrorEntry>(
    `select occurred_at::text as "occurredAt", source, account_id as "accountId",
            account_name as "accountName", message
     from sync_error_log order by occurred_at desc limit $1`,
    [Math.min(Math.max(limit, 1), 500)]
  );
  return rows;
}

export async function getSyncMeta(key: string): Promise<number | null> {
  const { rows } = await getPool().query<{ ms: string }>(
    `select (extract(epoch from updated_at) * 1000)::bigint::text as ms from sync_meta where key = $1`,
    [key]
  );
  return rows.length > 0 ? Number(rows[0].ms) : null;
}

export async function setSyncMeta(key: string): Promise<void> {
  await getPool().query(
    `insert into sync_meta (key, updated_at) values ($1, now())
     on conflict (key) do update set updated_at = now()`,
    [key]
  );
}

export async function upsertDailyMetrics(rows: DailyMetricRow[]): Promise<void> {
  if (rows.length === 0) return;
  const db = getPool();
  for (const batch of chunk(rows, UPSERT_BATCH_SIZE)) {
    const values: unknown[] = [];
    const placeholders = batch.map((r, i) => {
      const base = i * 11;
      values.push(
        r.accountId, r.adId, r.date, r.campaignId || null, r.adSetId || null,
        r.spend, r.impressions, r.clicks, r.reach, r.inbox, r.leads
      );
      const ph = Array.from({ length: 11 }, (_, j) => `$${base + j + 1}`);
      return `(${ph.join(",")}, now())`;
    });
    await db.query(
      `insert into ad_daily_metrics
         (account_id, ad_id, date, campaign_id, ad_set_id, spend, impressions, clicks, reach, inbox, leads, fetched_at)
       values ${placeholders.join(",")}
       on conflict (account_id, ad_id, date) do update set
         campaign_id = excluded.campaign_id,
         ad_set_id = excluded.ad_set_id,
         spend = excluded.spend,
         impressions = excluded.impressions,
         clicks = excluded.clicks,
         reach = excluded.reach,
         inbox = excluded.inbox,
         leads = excluded.leads,
         fetched_at = excluded.fetched_at`,
      values
    );
  }
}

export async function markSynced(accountId: string, dates: string[]): Promise<void> {
  if (dates.length === 0) return;
  const db = getPool();
  for (const batch of chunk(dates, UPSERT_BATCH_SIZE)) {
    const values: unknown[] = [];
    const placeholders = batch.map((d, i) => {
      values.push(accountId, d);
      return `($${i * 2 + 1}, $${i * 2 + 2}, now())`;
    });
    await db.query(
      `insert into ad_sync_progress (account_id, date, synced_at)
       values ${placeholders.join(",")}
       on conflict (account_id, date) do update set synced_at = excluded.synced_at`,
      values
    );
  }
}

export async function upsertAdNames(rows: AdNameRow[]): Promise<void> {
  if (rows.length === 0) return;
  const db = getPool();
  for (const batch of chunk(rows, UPSERT_BATCH_SIZE)) {
    const values: unknown[] = [];
    const placeholders = batch.map((r, i) => {
      const base = i * 5;
      values.push(r.adId, r.accountId, r.adName, r.campaignId || null, r.adSetId || null);
      return `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5}, now())`;
    });
    await db.query(
      `insert into ad_name_cache (ad_id, account_id, ad_name, campaign_id, ad_set_id, updated_at)
       values ${placeholders.join(",")}
       on conflict (ad_id) do update set
         account_id = excluded.account_id,
         ad_name = excluded.ad_name,
         campaign_id = excluded.campaign_id,
         ad_set_id = excluded.ad_set_id,
         updated_at = excluded.updated_at`,
      values
    );
  }
}

/** Reads stored metrics for the range, joined with the current ad name — callers re-derive branch/program via parseAdName(row.adName). */
export async function readInsightRows(accountIds: string[], since: string, until: string): Promise<StoredInsightRow[]> {
  if (accountIds.length === 0) return [];
  const { rows } = await getPool().query<StoredInsightRow>(
    `select
       m.account_id as "accountId",
       m.ad_id as "adId",
       coalesce(n.ad_name, '') as "adName",
       m.date::text as date,
       coalesce(m.campaign_id, n.campaign_id, '') as "campaignId",
       coalesce(m.ad_set_id, n.ad_set_id, '') as "adSetId",
       m.spend, m.impressions, m.clicks, m.reach, m.inbox, m.leads
     from ad_daily_metrics m
     left join ad_name_cache n on n.ad_id = m.ad_id
     where m.account_id = any($1::text[]) and m.date between $2 and $3`,
    [accountIds, since, until]
  );
  return rows;
}
