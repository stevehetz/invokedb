// A token bucket per client IP, in memory (one server process). Each key starts with `burst`
// tokens and gets `perSecond` back each second; a call takes one. Idle buckets are dropped so
// the map can't grow without bound.

/**
 * @param {{ perSecond: number, burst: number, maxKeys?: number, now?: () => number }} opts
 */
export function createRateLimiter({ perSecond, burst, maxKeys = 10_000, now = Date.now }) {
  /** @type {Map<string, { tokens: number, at: number }>} */
  const buckets = new Map();

  function prune(t) {
    for (const [key, b] of buckets) {
      if (b.tokens + ((t - b.at) / 1000) * perSecond >= burst) buckets.delete(key);
    }
  }

  return {
    /**
     * Takes a token for `key`. Answers `{ ok: true }`, or `{ ok: false, retryAfterSec }`.
     * @param {string} key
     */
    take(key) {
      const t = now();
      let b = buckets.get(key);
      if (!b) {
        if (buckets.size >= maxKeys) prune(t);
        // Still full of busy clients: refuse new ones rather than forget the busy ones
        if (buckets.size >= maxKeys) return { ok: false, retryAfterSec: 1 };
        b = { tokens: burst, at: t };
        buckets.set(key, b);
      }
      b.tokens = Math.min(burst, b.tokens + ((t - b.at) / 1000) * perSecond);
      b.at = t;
      if (b.tokens >= 1) {
        b.tokens -= 1;
        return { ok: true };
      }
      return { ok: false, retryAfterSec: Math.max(1, Math.ceil((1 - b.tokens) / perSecond)) };
    },
    /** For tests and the periodic sweep. */
    prune: () => prune(now()),
    size: () => buckets.size
  };
}
