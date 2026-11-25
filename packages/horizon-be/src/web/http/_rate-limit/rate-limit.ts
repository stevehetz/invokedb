import { CanActivate, ExecutionContext, HttpException, HttpStatus } from '@nestjs/common';

// Counts hits per key in a fixed window, in memory. There is one API process, so this is enough
// to keep a script from burning the Mailgun quota through the routes that send email (#133).
export class RateLimiter {
    private readonly hits = new Map<string, { count: number; reset_at: number }>();
    private next_sweep = 0;

    constructor(
        readonly limit: number,
        readonly window_ms: number,
        private readonly now: () => number = Date.now
    ) {}

    // Records a hit for the key. False when the key is over its limit for this window.
    hit(key: string): boolean {
        const now = this.now();
        this.sweep(now);
        const entry = this.hits.get(key);
        if (!entry || entry.reset_at <= now) {
            this.hits.set(key, { count: 1, reset_at: now + this.window_ms });
            return true;
        }
        entry.count++;
        return entry.count <= this.limit;
    }

    get size() {
        return this.hits.size;
    }

    // Drops expired keys, at most once a window, so the map doesn't grow without bound.
    private sweep(now: number) {
        if (now < this.next_sweep) return;
        this.next_sweep = now + this.window_ms;
        for (const [key, entry] of this.hits) {
            if (entry.reset_at <= now) this.hits.delete(key);
        }
    }
}

export const normalize_email = (value: unknown): string | null => {
    if (typeof value !== 'string') return null;
    const email = value.trim().toLowerCase();
    return email || null;
};

export interface RateLimitOptions {
    // Names the route in the keys, so each route has its own counters
    name: string;
    per_ip: number;
    per_email: number;
    window_ms: number;
}

export const TOO_MANY_REQUESTS_MESSAGE = 'Too many requests. Please wait a while and try again.';

// Limits a route by client IP and by the target email (`email` in the query or the body).
// `req.ip` is the client's address because main.ts trusts the one proxy in front (Caddy).
// Use as `@UseGuards(new RateLimitGuard({...}))`; each instance keeps its own counters.
export class RateLimitGuard implements CanActivate {
    private readonly by_ip: RateLimiter;
    private readonly by_email: RateLimiter;

    constructor(
        private readonly options: RateLimitOptions,
        now: () => number = Date.now
    ) {
        this.by_ip = new RateLimiter(options.per_ip, options.window_ms, now);
        this.by_email = new RateLimiter(options.per_email, options.window_ms, now);
    }

    canActivate(context: ExecutionContext): boolean {
        const req = context.switchToHttp().getRequest();
        this.check(req.ip, normalize_email(req.query?.email ?? req.body?.email));
        return true;
    }

    // Throws 429 when the IP or the email is over its limit. Both are counted on every call.
    check(ip: string | undefined, email: string | null) {
        const { name } = this.options;
        const ip_ok = this.by_ip.hit(`${name}:ip:${ip ?? 'unknown'}`);
        const email_ok = email ? this.by_email.hit(`${name}:email:${email}`) : true;
        if (!ip_ok || !email_ok) {
            throw new HttpException(TOO_MANY_REQUESTS_MESSAGE, HttpStatus.TOO_MANY_REQUESTS);
        }
    }
}
