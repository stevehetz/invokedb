// The no-signup demo (#333): a visitor's own throwaway account, filled with the showcase tables
// (showcase.ts) and deleted 24 hours after it's made. Pure rules only, unit-tested in
// demo.spec.ts; DemoService (application/demo) makes and sweeps the accounts.
import { HttpException, HttpStatus } from '@nestjs/common';
import { randomBytes } from 'crypto';

export const DEMO_HOURS = 24;
// Demo accounts one IP may make in a day, and live demo accounts on the whole server
export const DEMO_PER_IP_PER_DAY = 3;
export const DEMO_MAX_LIVE = 50;

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

// A demo account's email is never a mailbox: `.invalid` is reserved (RFC 2606), so nothing can
// be delivered there, and EmailManager drops anything sent to it before it reaches Mailgun
export const DEMO_EMAIL_DOMAIN = 'demo.invalid';

export const DEMO_OFF_MESSAGE = "This is off in the demo. Sign up to use it: it's free.";
export const DEMO_IP_MESSAGE =
    "You've made all the demos you can today. Sign up to keep going: it's free.";
export const DEMO_BUSY_MESSAGE = 'The demo is busy right now. Sign up instead: it takes a minute.';

export interface DemoAccountLike {
    email?: string | null;
    demo_expires_at?: Date | string | null;
}

/** A new demo account's email, `demo-<16 hex>@demo.invalid` (34 characters). */
export function demo_email(hex = randomBytes(8).toString('hex')) {
    return `demo-${hex}@${DEMO_EMAIL_DOMAIN}`;
}

/** An address of a demo account: no email ever goes to it. */
export function is_demo_email(email: unknown): boolean {
    return (
        typeof email === 'string' && email.trim().toLowerCase().endsWith(`@${DEMO_EMAIL_DOMAIN}`)
    );
}

/** Whether an account is a demo account: it has an expiry (or, failing that, a demo email). */
export function is_demo_account(account: DemoAccountLike | null | undefined): boolean {
    if (!account) return false;
    return (
        (account.demo_expires_at !== null && account.demo_expires_at !== undefined) ||
        is_demo_email(account.email)
    );
}

/** When a demo account made at `now` is deleted. */
export function demo_expires_at(now: number) {
    return new Date(now + DEMO_HOURS * HOUR);
}

/** The server-wide cap, `HORIZON_DEMO_MAX_LIVE` if it's a whole number, else DEMO_MAX_LIVE. */
export function demo_max_live(value: string | undefined): number {
    const n = Number(value);
    return value !== undefined && value !== '' && Number.isInteger(n) && n >= 0 ? n : DEMO_MAX_LIVE;
}

/** 403 `demo_account`: a feature that's off in the demo. */
export function demo_off_error() {
    return new HttpException(
        { message: DEMO_OFF_MESSAGE, code: 'demo_account', signup_url: '/create-account' },
        HttpStatus.FORBIDDEN
    );
}

/** Refuses a demo account (403 `demo_account`). */
export function assert_not_demo(account: DemoAccountLike | null | undefined) {
    if (is_demo_account(account)) throw demo_off_error();
}

/** 429 `demo_limit`: this IP made its demos for the day. */
export function demo_ip_error() {
    return new HttpException(
        { message: DEMO_IP_MESSAGE, code: 'demo_limit', limit: 'per_ip' },
        HttpStatus.TOO_MANY_REQUESTS
    );
}

/** 503 `demo_busy`: the server has as many live demo accounts as it takes. */
export function demo_busy_error() {
    return new HttpException(
        { message: DEMO_BUSY_MESSAGE, code: 'demo_busy', limit: 'live' },
        HttpStatus.SERVICE_UNAVAILABLE
    );
}

/**
 * The demo accounts one IP made in the last day, in memory (one API process). Only accounts
 * actually made count, not refused tries.
 */
export class DemoIpLimiter {
    private readonly made = new Map<string, number[]>();

    constructor(
        readonly limit = DEMO_PER_IP_PER_DAY,
        readonly window_ms = DAY
    ) {}

    private recent(ip: string, now: number) {
        const kept = (this.made.get(ip) || []).filter(t => t > now - this.window_ms);
        if (kept.length > 0) this.made.set(ip, kept);
        else this.made.delete(ip);
        return kept;
    }

    /** Whether `ip` may make another demo account at `now`. */
    allowed(ip: string, now: number) {
        return this.recent(ip || 'unknown', now).length < this.limit;
    }

    /** `ip` made a demo account at `now`. */
    record(ip: string, now: number) {
        const key = ip || 'unknown';
        this.made.set(key, [...this.recent(key, now), now]);
    }

    get size() {
        return this.made.size;
    }
}

/**
 * Which demo accounts a sweep deletes: expired ones (their `demo_expires_at` is past), with a
 * real id, soonest expired first, at most `limit`.
 */
export function expired_demo_ids(
    accounts: Array<{ id: unknown; demo_expires_at?: Date | string | null }>,
    now: number,
    limit = 50
): number[] {
    return accounts
        .map(a => ({ id: a && a.id, at: a ? time_of(a.demo_expires_at) : null }))
        .filter(a => Number.isInteger(a.id) && (a.id as number) > 0 && a.at !== null && a.at <= now)
        .sort((a, b) => a.at - b.at || (a.id as number) - (b.id as number))
        .map(a => a.id as number)
        .slice(0, Math.max(0, limit));
}

function time_of(value: Date | string | null | undefined): number | null {
    if (value === null || value === undefined) return null;
    const t = value instanceof Date ? value.getTime() : new Date(value).getTime();
    return Number.isFinite(t) ? t : null;
}

/** What `GET /auth/authorize` says of a demo account (null for any other). */
export function demo_info(account: DemoAccountLike | null | undefined) {
    if (!is_demo_account(account)) return null;
    const at = time_of(account.demo_expires_at);
    return { expires_at: at === null ? null : new Date(at).toISOString() };
}
