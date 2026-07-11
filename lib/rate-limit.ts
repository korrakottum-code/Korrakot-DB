interface RateLimitEntry {
  count: number;
  resetAt: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export class FixedWindowRateLimiter {
  private readonly entries = new Map<string, RateLimitEntry>();

  consume(key: string, limit: number, windowMs: number, nowMs = Date.now()): RateLimitResult {
    const current = this.entries.get(key);
    const entry = !current || current.resetAt <= nowMs
      ? { count: 0, resetAt: nowMs + windowMs }
      : current;

    entry.count += 1;
    this.entries.set(key, entry);

    if (this.entries.size > 5_000) {
      for (const [entryKey, value] of this.entries) {
        if (value.resetAt <= nowMs) this.entries.delete(entryKey);
      }
    }

    return {
      allowed: entry.count <= limit,
      remaining: Math.max(0, limit - entry.count),
      retryAfterSeconds: Math.max(1, Math.ceil((entry.resetAt - nowMs) / 1000)),
    };
  }

  reset(key: string): void {
    this.entries.delete(key);
  }
}

export function getRequestIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || headers.get("x-real-ip") || "unknown";
}

export const loginRateLimiter = new FixedWindowRateLimiter();
export const apiRateLimiter = new FixedWindowRateLimiter();

export function consumeApiRateLimit(
  headers: Headers,
  scope: string,
  limit: number,
  windowMs: number,
  nowMs = Date.now()
): RateLimitResult {
  return apiRateLimiter.consume(`${scope}:${getRequestIp(headers)}`, limit, windowMs, nowMs);
}
