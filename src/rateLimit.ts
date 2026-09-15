/**
 * Dead simple fixed-window rate limiter, kept in memory on purpose.
 *
 * Tradeoff worth knowing: counters live in this process, so they reset on deploy and
 * are per-instance. That is fine for a personal site on a single Railway container.
 * If this ever runs on more than one instance, swap the Map for Redis and keep the
 * same signature.
 * @author Chris "Mo" Mochinski
 */

interface RateLimiterOptions {
  /** How many requests a single key may make inside the window. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
}

export interface RateLimiter {
  /** Records a hit for `key` and returns false once the key is over its limit. */
  allow(key: string): boolean;
}

/**
 * @description Builds a limiter that counts hits per key inside a rolling fixed window.
 * Expired entries are pruned as they are touched, so idle keys do not pile up forever.
 */
export function createRateLimiter({ limit, windowMs }: RateLimiterOptions): RateLimiter {
  const hits = new Map<string, { count: number; resetAt: number }>();

  return {
    allow(key: string): boolean {
      const now = Date.now();
      const entry = hits.get(key);

      if (!entry || now >= entry.resetAt) {
        hits.set(key, { count: 1, resetAt: now + windowMs });
        // cheap opportunistic sweep so a flood of one-off IPs cannot grow the map forever
        if (hits.size > 5000) {
          for (const [k, v] of hits) if (now >= v.resetAt) hits.delete(k);
        }
        return true;
      }

      entry.count += 1;
      return entry.count <= limit;
    },
  };
}
