import { KeyRateLimiter } from './key-rate-limit';

describe('KeyRateLimiter', () => {
    let now: number;
    const clock = () => now;
    beforeEach(() => {
        now = 1_000_000;
    });

    it('allows a burst, then refuses with the seconds until a request is back', () => {
        const limiter = new KeyRateLimiter(clock);
        const limit = { per_second: 1, burst: 3 };
        for (let i = 0; i < 3; i++) expect(limiter.take(1, limit)).toEqual({ ok: true });
        expect(limiter.take(1, limit)).toEqual({ ok: false, retry_after_s: 1 });
    });

    it('refills at the rate, never past the burst', () => {
        const limiter = new KeyRateLimiter(clock);
        const limit = { per_second: 2, burst: 2 };
        limiter.take(1, limit);
        limiter.take(1, limit);
        expect(limiter.take(1, limit).ok).toBe(false);
        now += 500; // one request back
        expect(limiter.take(1, limit).ok).toBe(true);
        expect(limiter.take(1, limit).ok).toBe(false);
        now += 60_000; // full again, but only `burst` of them
        expect(limiter.take(1, limit).ok).toBe(true);
        expect(limiter.take(1, limit).ok).toBe(true);
        expect(limiter.take(1, limit).ok).toBe(false);
    });

    it('rounds Retry-After up for slow rates, and a refused request takes nothing', () => {
        const limiter = new KeyRateLimiter(clock);
        const limit = { per_second: 0.1, burst: 1 };
        expect(limiter.take(1, limit).ok).toBe(true);
        expect(limiter.take(1, limit)).toEqual({ ok: false, retry_after_s: 10 });
        now += 2_500;
        expect(limiter.take(1, limit)).toEqual({ ok: false, retry_after_s: 8 });
        now += 7_500;
        expect(limiter.take(1, limit).ok).toBe(true);
    });

    it('keeps each key apart', () => {
        const limiter = new KeyRateLimiter(clock);
        const limit = { per_second: 1, burst: 1 };
        expect(limiter.take(1, limit).ok).toBe(true);
        expect(limiter.take(1, limit).ok).toBe(false);
        expect(limiter.take(2, limit).ok).toBe(true);
    });

    it('starts again when the key has another limit', () => {
        const limiter = new KeyRateLimiter(clock);
        expect(limiter.take(1, { per_second: 1, burst: 1 }).ok).toBe(true);
        expect(limiter.take(1, { per_second: 1, burst: 1 }).ok).toBe(false);
        expect(limiter.take(1, { per_second: 5, burst: 5 }).ok).toBe(true);
    });

    it('drops refilled buckets so the map does not grow', () => {
        const limiter = new KeyRateLimiter(clock, 1000);
        for (let id = 1; id <= 50; id++) limiter.take(id, { per_second: 10, burst: 10 });
        limiter.take(999, { per_second: 0.1, burst: 1 });
        expect(limiter.size).toBe(51);
        now += 2_000;
        limiter.take(1000, { per_second: 1, burst: 1 });
        // the slow key's bucket is still refilling; the others are full and gone
        expect(limiter.size).toBe(2);
    });
});
