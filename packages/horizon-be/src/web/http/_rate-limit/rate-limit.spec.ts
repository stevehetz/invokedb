import { HttpException, HttpStatus } from '@nestjs/common';
import { normalize_email, RateLimiter, RateLimitGuard } from './rate-limit';

const HOUR = 60 * 60 * 1000;

const status_of = (fn: () => void) => {
    try {
        fn();
        return 200;
    } catch (err) {
        expect(err).toBeInstanceOf(HttpException);
        return (err as HttpException).getStatus();
    }
};

const context = (req: any) => ({ switchToHttp: () => ({ getRequest: () => req }) }) as any;

describe('RateLimiter', () => {
    it('allows hits up to the limit, then refuses until the window resets', () => {
        let now = 0;
        const limiter = new RateLimiter(3, HOUR, () => now);
        expect([1, 2, 3, 4].map(() => limiter.hit('a'))).toEqual([true, true, true, false]);
        expect(limiter.hit('b')).toBe(true);
        now = HOUR;
        expect(limiter.hit('a')).toBe(true);
    });

    it('drops expired keys', () => {
        let now = 0;
        const limiter = new RateLimiter(1, HOUR, () => now);
        limiter.hit('a');
        limiter.hit('b');
        now = HOUR;
        limiter.hit('c');
        expect(limiter.size).toBe(1);
    });
});

describe('RateLimitGuard', () => {
    const options = { name: 'reset', per_ip: 5, per_email: 2, window_ms: HOUR };

    it('answers 429 after repeated requests for one email, from different IPs', () => {
        const guard = new RateLimitGuard(options);
        const statuses = ['1.1.1.1', '2.2.2.2', '3.3.3.3'].map(ip =>
            status_of(() => guard.canActivate(context({ ip, query: { email: 'A@x.com ' } })))
        );
        expect(statuses).toEqual([200, 200, HttpStatus.TOO_MANY_REQUESTS]);
        // the email is normalized, and a body email counts too
        expect(
            status_of(() =>
                guard.canActivate(context({ ip: '4.4.4.4', body: { email: 'a@x.com' } }))
            )
        ).toBe(HttpStatus.TOO_MANY_REQUESTS);
    });

    it('answers 429 after repeated requests from one IP, for different emails', () => {
        const guard = new RateLimitGuard(options);
        const statuses = [1, 2, 3, 4, 5, 6].map(i =>
            status_of(() =>
                guard.canActivate(context({ ip: '1.1.1.1', query: { email: `${i}@x.com` } }))
            )
        );
        expect(statuses).toEqual([200, 200, 200, 200, 200, HttpStatus.TOO_MANY_REQUESTS]);
        expect(
            status_of(() =>
                guard.canActivate(context({ ip: '2.2.2.2', query: { email: 'z@x.com' } }))
            )
        ).toBe(200);
    });

    it('allows requests again after the window', () => {
        let now = 0;
        const guard = new RateLimitGuard(options, () => now);
        guard.check('1.1.1.1', 'a@x.com');
        guard.check('1.1.1.1', 'a@x.com');
        expect(status_of(() => guard.check('1.1.1.1', 'a@x.com'))).toBe(429);
        now = HOUR;
        expect(status_of(() => guard.check('1.1.1.1', 'a@x.com'))).toBe(200);
    });
});

describe('normalize_email', () => {
    it('trims and lowercases strings and ignores anything else', () => {
        expect(normalize_email(' A@X.com ')).toBe('a@x.com');
        expect(normalize_email('')).toBeNull();
        expect(normalize_email(['a@x.com'])).toBeNull();
        expect(normalize_email(undefined)).toBeNull();
    });
});
