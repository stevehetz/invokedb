// Idle free accounts (#184, docs/PRICING.md 3.4): pure rules, no I/O, unit-tested in
// idle.spec.ts with a fake clock. IdleAccountService runs them in the job processor.
//
// A free account with no sign-in and no API call for 6 months is deleted with all its data,
// after two warning emails: one at 5 months, one a week before 6 months. Each warning gives at
// least a week's notice, so an account that was already idle long enough (when this shipped, or
// after a missed run) is warned, warned again a week later and deleted a week after that. A
// sign-in or an API call starts the clock over and voids the warnings. Only ever Free: a paid
// account, an internal one (core/plan/plans.ts) and a deleted one are never touched.
import { account_plan, PlanAccount, TestPlan } from './plans';

export const IDLE_FIRST_WARNING_MONTHS = 5;
export const IDLE_DELETE_MONTHS = 6;
// The final warning goes out this long before the deletion, and every warning gives at least
// this much notice
export const IDLE_NOTICE_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface IdleAccount extends PlanAccount {
    id: number;
    deleted?: boolean | null;
    last_sign_in_at?: Date | string | null;
    last_api_call_at?: Date | string | null;
    idle_clock_at?: Date | string | null;
    idle_warned_at?: Date | string | null;
    idle_final_warned_at?: Date | string | null;
}

export type IdleAction = 'none' | 'warn_first' | 'warn_final' | 'delete';

export interface IdleDecision {
    action: IdleAction;
    // Since when the account has been idle (ms)
    idle_since: number | null;
    // When it would be deleted if nothing changes (ms), for the emails; null when it never is
    delete_at: number | null;
}

const ms = (d: Date | string | null | undefined): number | null => {
    if (d === null || d === undefined) return null;
    const t = new Date(d).getTime();
    return Number.isFinite(t) ? t : null;
};

/** `months` calendar months after `from` (UTC), clamped to the month's last day. */
export function add_months(from: number, months: number): number {
    const d = new Date(from);
    const day = d.getUTCDate();
    const target = new Date(from);
    target.setUTCDate(1);
    target.setUTCMonth(target.getUTCMonth() + months);
    const last = new Date(
        Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)
    ).getUTCDate();
    target.setUTCDate(Math.min(day, last));
    return target.getTime();
}

/** The latest of the sign-in, the API call and the idle clock; null when none is known. */
export function idle_since(a: IdleAccount): number | null {
    const times = [ms(a.last_sign_in_at), ms(a.last_api_call_at), ms(a.idle_clock_at)].filter(
        (t): t is number => t !== null
    );
    return times.length > 0 ? Math.max(...times) : null;
}

/** Whether the idle rule may ever delete this account: Free, not internal, not deleted. */
export function idle_rule_applies(a: IdleAccount, overrides?: Record<string, TestPlan>): boolean {
    if (!a || a.deleted) return false;
    const plan = overrides ? account_plan(a, overrides) : account_plan(a);
    return plan.plan.id === 'FREE' && !plan.internal;
}

/** What the idle job does with one account at `now`. */
export function idle_decision(
    a: IdleAccount,
    now: number,
    overrides?: Record<string, TestPlan>
): IdleDecision {
    const none: IdleDecision = { action: 'none', idle_since: null, delete_at: null };
    if (!idle_rule_applies(a, overrides)) return none;
    const since = idle_since(a);
    // Nothing to count from: never delete on a guess
    if (since === null) return none;

    const notice = IDLE_NOTICE_DAYS * DAY_MS;
    const delete_after = add_months(since, IDLE_DELETE_MONTHS);
    // A warning counts only if it was sent after the account was last used
    const first = ms(a.idle_warned_at);
    const first_valid = first !== null && first >= since;
    const final = ms(a.idle_final_warned_at);
    const final_valid = first_valid && final !== null && final >= since && final >= first;

    if (final_valid) {
        const delete_at = Math.max(delete_after, final + notice);
        return { action: now >= delete_at ? 'delete' : 'none', idle_since: since, delete_at };
    }
    if (first_valid) {
        const final_due = Math.max(delete_after - notice, first + notice);
        if (now >= final_due) {
            return {
                action: 'warn_final',
                idle_since: since,
                delete_at: Math.max(delete_after, now + notice)
            };
        }
        return {
            action: 'none',
            idle_since: since,
            delete_at: Math.max(delete_after, final_due + notice)
        };
    }
    const first_due = add_months(since, IDLE_FIRST_WARNING_MONTHS);
    if (now >= first_due) {
        return {
            action: 'warn_first',
            idle_since: since,
            delete_at: Math.max(delete_after, now + 2 * notice)
        };
    }
    return {
        action: 'none',
        idle_since: since,
        delete_at: Math.max(delete_after, first_due + 2 * notice)
    };
}

/** Whether a recorded time is old enough to write again (the API call is throttled). */
export function activity_stale(
    last: Date | string | null | undefined,
    now: number,
    every_ms: number
) {
    const t = ms(last);
    return t === null || now - t >= every_ms;
}

const fmt_date = (t: number) =>
    new Date(t).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        timeZone: 'UTC'
    });

/** The warning email (plain text). `tables`: how many tables would be lost. */
export function idle_warning_email(opts: {
    final: boolean;
    email: string;
    idle_since: number;
    delete_at: number;
    tables: number;
    sign_in_url: string;
}) {
    const lost =
        opts.tables > 0
            ? `its ${opts.tables} ${opts.tables === 1 ? 'table' : 'tables'} and everything in them`
            : 'its settings';
    const subject = opts.final
        ? 'Your InvokeDB account will be deleted in a week'
        : 'Your InvokeDB account will be deleted for not being used';
    const text = [
        'Hello,',
        '',
        `Your free InvokeDB account (${opts.email}) hasn't been used since ${fmt_date(opts.idle_since)}: ` +
            'no sign-in and no API call.',
        '',
        `Free accounts that aren't used for ${IDLE_DELETE_MONTHS} months are deleted. Unless it's ` +
            `used before ${fmt_date(opts.delete_at)}, this account will be deleted on that day, ` +
            `with ${lost}. This can't be undone.`,
        '',
        `To keep it, sign in (${opts.sign_in_url}) or make an API call with one of its keys. ` +
            'To keep a copy of your data first, export it from the Account page.',
        '',
        opts.final ? 'This is the last reminder.' : 'We will remind you once more a week before.',
        '',
        'The InvokeDB team'
    ].join('\n');
    return { subject, text };
}
