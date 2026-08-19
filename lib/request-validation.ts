const DATE_PRESETS = new Set([
  "today",
  "yesterday",
  "last_7d",
  "last_30d",
  "this_month",
  "last_month",
]);

const MAX_CUSTOM_RANGE_DAYS = 370;
export const MAX_CREATIVE_IDS = 200;

export interface ValidatedDateQuery {
  datePreset: string;
  since?: string;
  until?: string;
  forceRefresh: boolean;
}

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; error: string };

export function parseIsoDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) return null;
  return date;
}

export function validateDateQuery(searchParams: URLSearchParams): ValidationResult<ValidatedDateQuery> {
  const datePreset = searchParams.get("date_preset") || "last_30d";
  const since = searchParams.get("since") || undefined;
  const until = searchParams.get("until") || undefined;
  const refresh = searchParams.get("refresh");

  if (refresh !== null && refresh !== "0" && refresh !== "1") {
    return { ok: false, error: "refresh ต้องเป็น 0 หรือ 1" };
  }
  if (Boolean(since) !== Boolean(until)) {
    return { ok: false, error: "ต้องระบุ since และ until คู่กัน" };
  }

  if (since && until) {
    const sinceDate = parseIsoDate(since);
    const untilDate = parseIsoDate(until);
    if (!sinceDate || !untilDate) {
      return { ok: false, error: "วันที่ต้องอยู่ในรูปแบบ YYYY-MM-DD" };
    }
    if (sinceDate > untilDate) {
      return { ok: false, error: "since ต้องไม่เกิน until" };
    }
    const rangeDays = Math.floor((untilDate.getTime() - sinceDate.getTime()) / 86_400_000) + 1;
    if (rangeDays > MAX_CUSTOM_RANGE_DAYS) {
      return { ok: false, error: `ช่วงวันที่ต้องไม่เกิน ${MAX_CUSTOM_RANGE_DAYS} วัน` };
    }
  } else if (!DATE_PRESETS.has(datePreset)) {
    return { ok: false, error: "date_preset ไม่ถูกต้อง" };
  }

  return {
    ok: true,
    value: { datePreset, since, until, forceRefresh: refresh === "1" },
  };
}

/** since/until บังคับคู่กันเสมอ ไม่มี preset — ใช้กับ API ภายนอกที่ผู้เรียกระบุวันที่เอง (เช่น Qlass) */
export function validateExternalDateRangeQuery(searchParams: URLSearchParams): ValidationResult<{ since: string; until: string }> {
  const since = searchParams.get("since");
  const until = searchParams.get("until");
  if (!since || !until) {
    return { ok: false, error: "ต้องระบุ since และ until" };
  }
  const sinceDate = parseIsoDate(since);
  const untilDate = parseIsoDate(until);
  if (!sinceDate || !untilDate) {
    return { ok: false, error: "วันที่ต้องอยู่ในรูปแบบ YYYY-MM-DD" };
  }
  if (sinceDate > untilDate) {
    return { ok: false, error: "since ต้องไม่เกิน until" };
  }
  const rangeDays = Math.floor((untilDate.getTime() - sinceDate.getTime()) / 86_400_000) + 1;
  if (rangeDays > MAX_CUSTOM_RANGE_DAYS) {
    return { ok: false, error: `ช่วงวันที่ต้องไม่เกิน ${MAX_CUSTOM_RANGE_DAYS} วัน` };
  }
  return { ok: true, value: { since, until } };
}

function splitCsv(value: string | null): string[] {
  if (!value) return [];
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

export function validateCreativeQuery(
  searchParams: URLSearchParams
): ValidationResult<{ adIds: string[]; accountIds: string[] }> {
  const adIds = splitCsv(searchParams.get("ad_ids"));
  const accountIds = splitCsv(searchParams.get("account_ids"));

  if (adIds.length > MAX_CREATIVE_IDS) {
    return { ok: false, error: `ขอ Creative ได้ไม่เกิน ${MAX_CREATIVE_IDS} รายการต่อครั้ง` };
  }
  if (accountIds.length > 0 && accountIds.length !== adIds.length) {
    return { ok: false, error: "จำนวน account_ids ต้องเท่ากับ ad_ids" };
  }
  if (adIds.some((id) => !/^\d{5,30}$/.test(id))) {
    return { ok: false, error: "ad_ids ไม่ถูกต้อง" };
  }
  if (accountIds.some((id) => !/^(?:act_)?\d{5,30}$/.test(id))) {
    return { ok: false, error: "account_ids ไม่ถูกต้อง" };
  }

  return { ok: true, value: { adIds, accountIds } };
}
