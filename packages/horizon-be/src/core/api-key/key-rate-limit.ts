// A key's own request limit (#216): a token bucket per key, in memory. There is one API process
// (like RateLimiter in web/http/_rate-limit), so this is enough. Unit-tested in
// key-rate-limit.spec.ts.
import type { KeyRateLimit } from './api-key-rules';

interface Bucket {
    tokens: number;
    at: number;
    per_second: number;
    burst: number;
}

export type TakeResult = { ok: true } | { ok: false; retry_after_s: number };

export class KeyRateLimiter {
    private readonly buckets = new Map<number, Bucket>();
    private next_sweep = 0;

    constructor(
        private readonly now: () => number = Date.now,
        private readonly sweep_every_ms = 60 * 1000
    ) {}

    /**
     * Takes one request from the key's bucket. A full bucket holds `burst` requests and refills
     * at `per_second`. Refused: `retry_after_s` is the whole seconds until one is back (at least 1,
     * for `Retry-After`). A refused request takes nothing.
     */
    take(key_id: number, limit: KeyRateLimit): TakeResult {
        const now = this.now();
        this.sweep(now);
        let bucket = this.buckets.get(key_id);
        if (!bucket || bucket.per_second !== limit.per_second || bucket.burst !== limit.burst) {
            bucket = { tokens: limit.burst, at: now, ...limit };
            this.buckets.set(key_id, bucket);
        } else {
            const elapsed_s = Math.max(0, now - bucket.at) / 1000;
            bucket.tokens = Math.min(bucket.burst, bucket.tokens + elapsed_s * bucket.per_second);
            bucket.at = now;
        }
        if (bucket.tokens >= 1) {
            bucket.tokens -= 1;
            return { ok: true };
        }
        const wait_s = (1 - bucket.tokens) / bucket.per_second;
        return { ok: false, retry_after_s: Math.max(1, Math.ceil(wait_s)) };
    }

    get size() {
        return this.buckets.size;
    }

    // Drops buckets that have refilled (a new one starts full anyway), at most once a minute, so
    // the map doesn't grow without bound.
    private sweep(now: number) {
        if (now < this.next_sweep) return;
        this.next_sweep = now + this.sweep_every_ms;
        for (const [id, b] of this.buckets) {
            const full_at = b.at + ((b.burst - b.tokens) / b.per_second) * 1000;
            if (full_at <= now) this.buckets.delete(id);
        }
    }
}
