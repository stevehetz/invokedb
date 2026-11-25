import { HttpException, HttpStatus } from '@nestjs/common';
import { RateLimiter, TOO_MANY_REQUESTS_MESSAGE } from '../_rate-limit/rate-limit';
import { FORM_RATE_LIMITS } from '@app/core/form/form';

// The limits on a public form's submissions (#145), in memory like the other rate limits (#133):
// per client IP on one form, per client IP on all forms, and per form from everyone.
export class FormRateLimit {
    private readonly by_ip_form: RateLimiter;
    private readonly by_ip: RateLimiter;
    private readonly by_form: RateLimiter;

    constructor(limits = FORM_RATE_LIMITS, now: () => number = Date.now) {
        this.by_ip_form = new RateLimiter(limits.per_ip_per_form, limits.window_ms, now);
        this.by_ip = new RateLimiter(limits.per_ip, limits.window_ms, now);
        this.by_form = new RateLimiter(limits.per_form, limits.per_form_window_ms, now);
    }

    /** Counts a submission on every limit; throws 429 when it's over one of them. */
    check(form_id: string, ip: string | undefined) {
        const id = String(form_id).slice(0, 64);
        const client = ip || 'unknown';
        const ip_form_ok = this.by_ip_form.hit(`${id}:${client}`);
        const ip_ok = this.by_ip.hit(client);
        const form_ok = this.by_form.hit(id);
        if (!ip_form_ok || !ip_ok || !form_ok) {
            throw new HttpException(TOO_MANY_REQUESTS_MESSAGE, HttpStatus.TOO_MANY_REQUESTS);
        }
    }
}
