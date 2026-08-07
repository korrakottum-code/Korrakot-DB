interface CacheEntry<T> {
  value: T;
  fetchedAt: string;
  expiresAt: number;
}

interface CacheResult<T> {
  value: T;
  fetchedAt: string;
  hit: boolean;
  /** true = ค่าที่ได้หมดอายุแล้วแต่ยังเสิร์ฟไปก่อน ระหว่างรีเฟรชเบื้องหลัง */
  stale?: boolean;
}

interface CacheOptions {
  /**
   * stale-while-revalidate: หลังหมดอายุ ยังเสิร์ฟค่าเก่าต่อได้อีกไม่เกินเท่านี้ (ms)
   * โดยคืนค่าทันทีแล้วยิง loader รีเฟรชเบื้องหลัง — คนเปิดหน้าเว็บไม่ต้องรอโหลดใหม่
   */
  staleTtlMs?: number;
}

const entries = new Map<string, CacheEntry<unknown>>();
const inFlight = new Map<string, Promise<CacheResult<unknown>>>();

function startLoad<T>(key: string, ttlMs: number, loader: () => Promise<T>): Promise<CacheResult<T>> {
  const pending = loader().then((value) => {
    const fetchedAt = new Date().toISOString();
    entries.set(key, { value, fetchedAt, expiresAt: Date.now() + ttlMs });
    return { value, fetchedAt, hit: false };
  });
  inFlight.set(key, pending as Promise<CacheResult<unknown>>);
  pending.finally(() => {
    if (inFlight.get(key) === (pending as Promise<CacheResult<unknown>>)) inFlight.delete(key);
  }).catch(() => {});
  return pending;
}

export async function getServerCache<T>(
  key: string,
  ttlMs: number,
  loader: () => Promise<T>,
  forceRefresh = false,
  options: CacheOptions = {}
): Promise<CacheResult<T>> {
  const now = Date.now();
  const existing = entries.get(key) as CacheEntry<T> | undefined;

  if (!forceRefresh && existing && existing.expiresAt > now) {
    return { value: existing.value, fetchedAt: existing.fetchedAt, hit: true };
  }

  // หมดอายุแต่ยังอยู่ในช่วง staleTtlMs → คืนค่าเก่าทันที แล้วรีเฟรชเบื้องหลัง
  const staleTtlMs = options.staleTtlMs ?? 0;
  if (
    !forceRefresh &&
    existing &&
    staleTtlMs > 0 &&
    existing.expiresAt + staleTtlMs > now
  ) {
    if (!inFlight.has(key)) {
      // ถ้ารีเฟรชเบื้องหลังพัง เก็บค่าเก่าไว้เสิร์ฟต่อ — อย่าให้ unhandled rejection
      startLoad(key, ttlMs, loader).catch(() => {});
    }
    return { value: existing.value, fetchedAt: existing.fetchedAt, hit: true, stale: true };
  }

  if (!forceRefresh) {
    const pending = inFlight.get(key) as Promise<CacheResult<T>> | undefined;
    if (pending) {
      const result = await pending;
      return { ...result, hit: true };
    }
  }

  return startLoad(key, ttlMs, loader);
}

/** ลบ cache รายคีย์ — ใช้หลัง sync เบื้องหลังเสร็จ เพื่อให้ request ถัดไปประกอบคำตอบจากข้อมูลใหม่ */
export function deleteServerCache(key: string): void {
  entries.delete(key);
}

export function clearServerCache(): void {
  entries.clear();
  inFlight.clear();
}
