interface CacheEntry<T> {
  value: T;
  fetchedAt: string;
  expiresAt: number;
}

interface CacheResult<T> {
  value: T;
  fetchedAt: string;
  hit: boolean;
}

const entries = new Map<string, CacheEntry<unknown>>();
const inFlight = new Map<string, Promise<CacheResult<unknown>>>();

export async function getServerCache<T>(
  key: string,
  ttlMs: number,
  loader: () => Promise<T>,
  forceRefresh = false
): Promise<CacheResult<T>> {
  const now = Date.now();
  const existing = entries.get(key) as CacheEntry<T> | undefined;

  if (!forceRefresh && existing && existing.expiresAt > now) {
    return { value: existing.value, fetchedAt: existing.fetchedAt, hit: true };
  }

  if (!forceRefresh) {
    const pending = inFlight.get(key) as Promise<CacheResult<T>> | undefined;
    if (pending) {
      const result = await pending;
      return { ...result, hit: true };
    }
  }

  const pending = loader().then((value) => {
    const fetchedAt = new Date().toISOString();
    entries.set(key, { value, fetchedAt, expiresAt: Date.now() + ttlMs });
    return { value, fetchedAt, hit: false };
  });

  inFlight.set(key, pending as Promise<CacheResult<unknown>>);
  try {
    return await pending;
  } finally {
    inFlight.delete(key);
  }
}

export function clearServerCache(): void {
  entries.clear();
  inFlight.clear();
}
