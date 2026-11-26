// Small in-memory rate limiter (fixed window per key). It lives in one server
// instance, so on Vercel the limit is per container — good enough to slow down
// someone hammering sign-in, not a hard guarantee.

export interface RateLimitResult {
  ok: boolean;
  retryAfterSeconds: number;
}

export interface RateLimiter {
  hit(key: string): RateLimitResult;
  size(): number;
}

export function createRateLimiter(opts: {
  limit: number;
  windowMs: number;
  maxKeys?: number;
  now?: () => number;
}): RateLimiter {
  const { limit, windowMs, maxKeys = 10_000, now = Date.now } = opts;
  // Map keeps insertion order, so the first key is the least recently touched.
  const windows = new Map<string, { start: number; count: number }>();

  return {
    hit(key) {
      const t = now();
      let w = windows.get(key);
      if (!w || t - w.start >= windowMs) w = { start: t, count: 0 };
      windows.delete(key);
      windows.set(key, w);
      while (windows.size > maxKeys) {
        const oldest = windows.keys().next().value as string;
        windows.delete(oldest);
      }
      w.count += 1;
      if (w.count > limit) {
        return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((w.start + windowMs - t) / 1000)) };
      }
      return { ok: true, retryAfterSeconds: 0 };
    },
    size: () => windows.size,
  };
}

export function clientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return req.headers.get("x-real-ip")?.trim() || "unknown";
}
