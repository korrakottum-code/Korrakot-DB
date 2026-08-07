import { Pool } from "pg";

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
export async function findMissingFinalRanges(accountIds: string[], finalDates: string[]): Promise<DateRange[]> {
  if (finalDates.length === 0 || accountIds.length === 0) return [];
  const { rows } = await getPool().query<{ accountId: string; date: string }>(
    `select account_id as "accountId", date::text as date
     from ad_sync_progress
     where account_id = any($1::text[]) and date = any($2::date[])
       and synced_at >= date + interval '1 day' * $3`,
    [accountIds, finalDates, SETTLING_WINDOW_DAYS + 1]
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

/** true เมื่อทุกคู่ (account, date) ของช่วง recent ถูก sync ภายใน maxAgeMs — ใช้ข้ามการยิง Meta ซ้ำเมื่อสลับ preset */
export async function isRecentWindowFresh(accountIds: string[], recentDates: string[], maxAgeMs: number): Promise<boolean> {
  if (recentDates.length === 0 || accountIds.length === 0) return true;
  const { rows } = await getPool().query<{ n: number }>(
    `select count(*)::int as n from ad_sync_progress
     where account_id = any($1::text[]) and date = any($2::date[])
       and synced_at > now() - interval '1 millisecond' * $3`,
    [accountIds, recentDates, maxAgeMs]
  );
  return rows[0].n === accountIds.length * recentDates.length;
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
