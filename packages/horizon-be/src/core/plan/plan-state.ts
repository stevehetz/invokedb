// The plan state of an account (#184, docs/PRICING.md 3.4): pure rules, no I/O, unit-tested in
// plan-state.spec.ts. PlanStateService stores the state; TrackingManager refuses writes with it.
//
// - 'active': the plan's caps apply as usual (core/plan/plans.ts).
// - 'grace': a payment failed (Stripe, #129): full access and a banner until `grace_ends_at`
//   (14 days), then the account is on Free, and read-only if it's over Free's caps.
// - 'read_only': over the current plan's caps (after a downgrade or a lapse): reads, exports and
//   deletes work; creates, updates, column changes, uploads, URL syncs and new webhooks and
//   views are refused with 403 `plan_read_only`. It clears by itself once
//   the account is under the caps.
//
// The state is its own column, apart from the `locked` flag: neither ever sets or lifts the
// other.
import { HttpException, HttpStatus } from '@nestjs/common';
import { Plan, upgrade_url } from './plans';

export type PlanState = 'active' | 'grace' | 'read_only';
export const PLAN_STATES: PlanState[] = ['active', 'grace', 'read_only'];

export const GRACE_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

// The caps an account can be over: what it has, not what it does (the API quota and rate limit
// are refused with 429 as they're used, never a state)
export const STOCK_CAPS = [
    'tables',
    'rows_per_account',
    'rows_per_table',
    'storage_bytes',
    'columns_per_table',
    'url_sources',
    'webhooks',
    'views_per_table'
] as const;
export type StockCap = (typeof STOCK_CAPS)[number];

/** A stored state, or 'active' for anything else (an old row, a typo). */
export function parse_plan_state(value: unknown): PlanState {
    return PLAN_STATES.includes(value as PlanState) ? (value as PlanState) : 'active';
}

/**
 * The caps an account is over, from what `GET /usage` answers (core/plan/usage.ts): each
 * `{ used, cap }`, where a null cap is no cap (an internal account).
 */
export function over_caps(
    usage: Partial<Record<string, { used: number; cap: number | null }>>
): StockCap[] {
    return STOCK_CAPS.filter(k => {
        const item = usage && usage[k];
        return !!item && item.cap !== null && Number.isFinite(item.cap) && item.used > item.cap;
    });
}

/** When a grace period started at `now` ends. */
export function grace_end(now: number): Date {
    return new Date(now + GRACE_DAYS * DAY_MS);
}

/** Whether the account is in a grace period that has ended (none without an end date). */
export function grace_ended(
    state: PlanState,
    grace_ends_at: Date | string | null | undefined,
    now: number
) {
    if (state !== 'grace') return false;
    if (!grace_ends_at) return true;
    const end = new Date(grace_ends_at).getTime();
    return !Number.isFinite(end) || now >= end;
}

/**
 * The state an account should be in, given its stored state and the caps it's over (with its
 * plan as it is now; a grace period that has ended must be turned into Free first). A grace
 * period still running keeps full access whatever the account holds.
 */
export function next_plan_state(
    current: PlanState,
    grace_ends_at: Date | string | null | undefined,
    over: readonly string[],
    now: number
): PlanState {
    if (current === 'grace' && !grace_ended(current, grace_ends_at, now)) return 'grace';
    return over.length > 0 ? 'read_only' : 'active';
}

// What each cap is called in the read-only message
const OVER_LABELS: Record<StockCap, string> = {
    tables: 'tables',
    rows_per_account: 'rows in all',
    rows_per_table: 'rows in a table',
    storage_bytes: 'storage',
    columns_per_table: 'columns in a table',
    url_sources: 'tables imported from a URL',
    webhooks: 'webhooks',
    views_per_table: 'views of a table'
};

/** What a write refused for the read-only state says, and the body it carries. */
export function plan_read_only_body(plan: Plan, over: readonly string[]) {
    const labels = over.map(k => OVER_LABELS[k as StockCap] || k);
    const what = labels.length > 0 ? ` (${labels.join(', ')})` : '';
    return {
        message:
            `Your account is over its plan's (${plan.name}) limits${what}, so it's read-only: ` +
            'you can read, export and delete data, but not add or change any. Delete down to ' +
            'the limits, or upgrade.',
        code: 'plan_read_only',
        over: [...over],
        plan: plan.id,
        upgrade_url: upgrade_url()
    };
}

/** 403 `plan_read_only`: a write by a read-only account. */
export function plan_read_only_error(plan: Plan, over: readonly string[]) {
    return new HttpException(plan_read_only_body(plan, over), HttpStatus.FORBIDDEN);
}
