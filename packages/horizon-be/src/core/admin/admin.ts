// The admin area (#277): the owner runs the service from /app/admin instead of SSH and database
// queries. Pure rules only (no I/O), unit-tested in admin.spec.ts: who is an admin, the plans an
// admin can put an account on, which caps an account is over or near, the accounts list's
// search, sort and paging, and the overview's figures. AdminService gathers the numbers.
import {
    AccountPlan,
    PLANS,
    PLAN_SUBSCRIPTIONS,
    PlanCaps,
    PlanId,
    account_plan
} from '../plan/plans';

// ---- Who is an admin ----

/** `HORIZON_ADMIN_EMAILS`: a comma-separated allowlist, lower-cased. Empty or unset: nobody. */
export function parse_admin_emails(value: string | undefined | null): Set<string> {
    return new Set(
        String(value || '')
            .split(',')
            .map(e => e.trim().toLowerCase())
            .filter(e => e !== '')
    );
}

export interface AdminCandidate {
    email?: string | null;
    email_verified?: boolean | null;
    deleted?: boolean | null;
}

/**
 * The second factor an admin needs (#288): our two-factor sign-in for a password account; an
 * account with no password can only sign in through Google or GitHub, which hold its second
 * factor (the owner's decision: trust the provider), so it passes.
 */
export function second_factor_ok(has_password: boolean, two_factor_on: boolean): boolean {
    return !has_password || two_factor_on === true;
}

/**
 * An admin is an account on the allowlist, not deleted, with a verified email and a second
 * factor (`second_factor_ok`). All four, checked on every admin route.
 */
export function is_admin(
    account: AdminCandidate | null | undefined,
    two_factor_on: boolean,
    emails: Set<string>
): boolean {
    if (!account || account.deleted === true) return false;
    if (account.email_verified !== true || two_factor_on !== true) return false;
    const email = String(account.email || '')
        .trim()
        .toLowerCase();
    return email !== '' && emails.has(email);
}

// ---- Plans an admin can set ----

// Until Stripe (#129): the three plans, or "internal" (no counted caps, like INTERNAL_EMAILS)
export const ADMIN_PLANS = ['FREE', 'STARTER', 'PRO', 'INTERNAL'] as const;
export type AdminPlan = (typeof ADMIN_PLANS)[number];

export class AdminInputError extends Error {}

/** What a plan change writes on the account. Internal keeps the subscription (its plan's name). */
export function plan_change(plan: unknown): { subscription_id?: string; internal: boolean } {
    if (typeof plan !== 'string' || !(ADMIN_PLANS as readonly string[]).includes(plan)) {
        throw new AdminInputError(`plan must be one of ${ADMIN_PLANS.join(', ')}`);
    }
    if (plan === 'INTERNAL') return { internal: true };
    return { subscription_id: PLAN_SUBSCRIPTIONS[plan as PlanId], internal: false };
}

/** The plan an account is on, as the admin area names it. */
export function admin_plan_of(plan: AccountPlan): AdminPlan {
    return plan.internal ? 'INTERNAL' : plan.plan.id;
}

export function admin_plan_name(plan: AdminPlan): string {
    return plan === 'INTERNAL' ? 'Internal' : PLANS[plan].name;
}

// The `locked_reason` column is a VARCHAR(150)
export const LOCK_REASON_MAX = 150;
export const DEFAULT_LOCK_REASON = 'Locked by InvokeDB support';

export function lock_reason(value: unknown): string {
    const reason = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
    if (reason.length > LOCK_REASON_MAX) {
        throw new AdminInputError(`reason must be at most ${LOCK_REASON_MAX} characters`);
    }
    return reason || DEFAULT_LOCK_REASON;
}

/** Deleting an account takes its email typed again (any case, spaces around ignored). */
export function delete_confirmed(email: string | null | undefined, typed: unknown): boolean {
    const want = String(email || '')
        .trim()
        .toLowerCase();
    return want !== '' && typeof typed === 'string' && typed.trim().toLowerCase() === want;
}

// ---- Caps an account is over or near (docs/PRICING.md 3.2, #183) ----

// The share of a cap from which an account is "near" it
export const NEAR_SHARE = 0.8;

// The counted caps the list checks: the ones with a number that grows with use
export const FLAGGED_CAPS = [
    'tables',
    'rows_per_account',
    'rows_per_table',
    'storage_bytes',
    'api_calls_per_month'
] as const;
export type FlaggedCap = (typeof FLAGGED_CAPS)[number];

export interface CapUse {
    tables: number;
    rows_per_account: number;
    // The fullest table's rows
    rows_per_table: number;
    storage_bytes: number;
    api_calls_per_month: number;
}

export interface CapFlag {
    limit: FlaggedCap;
    used: number;
    cap: number;
    // At or past the cap, or from NEAR_SHARE of it
    level: 'over' | 'near';
}

/** The caps an account is at or over, or near. An internal account (no caps) has none. */
export function cap_flags(use: CapUse, caps: PlanCaps): CapFlag[] {
    const out: CapFlag[] = [];
    for (const limit of FLAGGED_CAPS) {
        const cap = caps[limit] as number;
        const used = Number(use[limit]) || 0;
        if (!Number.isFinite(cap) || cap <= 0) continue;
        if (used >= cap) out.push({ limit, used, cap, level: 'over' });
        else if (used >= cap * NEAR_SHARE) out.push({ limit, used, cap, level: 'near' });
    }
    return out;
}

// ---- The accounts list ----

export interface AccountRow {
    id: number;
    email: string;
    plan: AdminPlan;
    plan_name: string;
    created_at: number | null;
    // The last sign-in or API key call
    last_active_at: number | null;
    verified: boolean;
    two_factor: boolean;
    tables: number;
    rows: number;
    storage_bytes: number;
    api_calls: number;
    ai_cost_usd: number;
    locked: boolean;
    locked_reason: string | null;
    caps: CapFlag[];
}

export interface AccountFacts {
    id: number;
    email: string;
    email_verified: boolean;
    subscription_id: string | null;
    internal: boolean;
    locked: boolean;
    locked_reason: string | null;
    created_at: number | null;
    last_active_at: number | null;
    two_factor: boolean;
    // Rows per table
    table_rows: number[];
    storage_bytes: number;
    api_calls: number;
    ai_cost_micros: number;
}

/** One line of the accounts list, from what is already counted for the account. */
export function account_row(f: AccountFacts): AccountRow {
    const plan = account_plan({
        email: f.email,
        email_verified: f.email_verified,
        subscription_id: f.subscription_id,
        internal: f.internal
    });
    const admin_plan = admin_plan_of(plan);
    const rows = f.table_rows.reduce((sum, n) => sum + n, 0);
    const use: CapUse = {
        tables: f.table_rows.length,
        rows_per_account: rows,
        rows_per_table: f.table_rows.reduce((m, n) => Math.max(m, n), 0),
        storage_bytes: f.storage_bytes,
        api_calls_per_month: f.api_calls
    };
    return {
        id: f.id,
        email: f.email,
        plan: admin_plan,
        plan_name: admin_plan === 'INTERNAL' ? `Internal (${plan.plan.name})` : plan.plan.name,
        created_at: f.created_at,
        last_active_at: f.last_active_at,
        verified: f.email_verified === true,
        two_factor: f.two_factor,
        tables: use.tables,
        rows,
        storage_bytes: f.storage_bytes,
        api_calls: f.api_calls,
        ai_cost_usd: micros_to_usd(f.ai_cost_micros),
        locked: f.locked === true,
        locked_reason: f.locked ? f.locked_reason || null : null,
        caps: cap_flags(use, plan.caps)
    };
}

export const micros_to_usd = (micros: number) => Math.round(Number(micros) || 0) / 1_000_000;

export const ACCOUNT_SORTS = [
    'email',
    'plan',
    'created_at',
    'last_active_at',
    'tables',
    'rows',
    'storage_bytes',
    'api_calls',
    'ai_cost_usd'
] as const;
export type AccountSort = (typeof ACCOUNT_SORTS)[number];

// `caps`: every account, those at or over a cap, near one (and not over any), or either
export const CAP_FILTERS = ['all', 'over', 'near', 'flagged'] as const;
export type CapFilter = (typeof CAP_FILTERS)[number];

export const ACCOUNTS_PAGE_DEFAULT = 25;
export const ACCOUNTS_PAGE_MAX = 100;
export const SEARCH_MAX = 100;

export interface AccountQuery {
    search: string;
    sort: AccountSort;
    dir: 'asc' | 'desc';
    page: number;
    limit: number;
    caps: CapFilter;
    plan: AdminPlan | null;
}

/** `?search=&sort=&dir=&page=&limit=&caps=&plan=` of the accounts list. */
export function parse_account_query(query: any): AccountQuery {
    const q = query && typeof query === 'object' ? query : {};
    const str = (v: unknown) => (typeof v === 'string' ? v : '');
    const search = str(q.search).trim().toLowerCase();
    if (search.length > SEARCH_MAX) {
        throw new AdminInputError(`search must be at most ${SEARCH_MAX} characters`);
    }
    const sort = (str(q.sort) || 'created_at') as AccountSort;
    if (!ACCOUNT_SORTS.includes(sort)) {
        throw new AdminInputError(`sort must be one of ${ACCOUNT_SORTS.join(', ')}`);
    }
    const dir = str(q.dir) || 'desc';
    if (dir !== 'asc' && dir !== 'desc') throw new AdminInputError('dir must be asc or desc');
    const whole = (v: unknown, name: string, min: number, max: number, def: number) => {
        if (v === undefined || v === '') return def;
        const n = Number(v);
        if (!Number.isInteger(n) || n < min || n > max) {
            throw new AdminInputError(`${name} must be a whole number from ${min} to ${max}`);
        }
        return n;
    };
    const page = whole(q.page, 'page', 1, 1_000_000, 1);
    const limit = whole(q.limit, 'limit', 1, ACCOUNTS_PAGE_MAX, ACCOUNTS_PAGE_DEFAULT);
    const caps = (str(q.caps) || 'all') as CapFilter;
    if (!CAP_FILTERS.includes(caps)) {
        throw new AdminInputError(`caps must be one of ${CAP_FILTERS.join(', ')}`);
    }
    const plan = str(q.plan) || null;
    if (plan !== null && !(ADMIN_PLANS as readonly string[]).includes(plan)) {
        throw new AdminInputError(`plan must be one of ${ADMIN_PLANS.join(', ')}`);
    }
    return { search, sort, dir, page, limit, caps, plan: plan as AdminPlan | null };
}

function cap_level(row: AccountRow): 'over' | 'near' | null {
    if (row.caps.some(c => c.level === 'over')) return 'over';
    if (row.caps.some(c => c.level === 'near')) return 'near';
    return null;
}

function matches(row: AccountRow, q: AccountQuery) {
    if (q.search && !row.email.toLowerCase().includes(q.search) && String(row.id) !== q.search) {
        return false;
    }
    if (q.plan && row.plan !== q.plan) return false;
    const level = cap_level(row);
    if (q.caps === 'over') return level === 'over';
    if (q.caps === 'near') return level === 'near';
    if (q.caps === 'flagged') return level !== null;
    return true;
}

/** One page of the list: searched (email or id), filtered, sorted (nulls last), paged. */
export function list_accounts(rows: AccountRow[], q: AccountQuery) {
    const found = rows.filter(r => matches(r, q));
    const sign = q.dir === 'asc' ? 1 : -1;
    found.sort((a, b) => {
        const x = a[q.sort];
        const y = b[q.sort];
        if (x === null && y !== null) return 1;
        if (y === null && x !== null) return -1;
        if (x !== null && y !== null && x !== y) {
            const c = typeof x === 'string' ? x.localeCompare(String(y)) : Number(x) - Number(y);
            if (c !== 0) return c * sign;
        }
        return a.id - b.id;
    });
    const start = (q.page - 1) * q.limit;
    return {
        accounts: found.slice(start, start + q.limit),
        total: found.length,
        page: q.page,
        limit: q.limit
    };
}

// ---- The overview ----

const DAY = 24 * 60 * 60 * 1000;
export const SIGNUP_DAYS = 30;

/** Sign-ups on each of the last `days` UTC days, oldest first, today included. */
export function signups_per_day(created: (number | null)[], now: number, days = SIGNUP_DAYS) {
    const today = Math.floor(now / DAY);
    const counts = new Map<number, number>();
    for (const at of created) {
        if (at === null || !Number.isFinite(at)) continue;
        const day = Math.floor(at / DAY);
        if (day > today - days && day <= today) counts.set(day, (counts.get(day) || 0) + 1);
    }
    const out: { day: string; count: number }[] = [];
    for (let d = today - days + 1; d <= today; d++) {
        out.push({ day: new Date(d * DAY).toISOString().slice(0, 10), count: counts.get(d) || 0 });
    }
    return out;
}

/** Accounts active (signed in or called the API) in the last 7 and 30 days. */
export function active_counts(last_active: (number | null)[], now: number) {
    const within = (days: number) =>
        last_active.filter(at => at !== null && at > now - days * DAY && at <= now + DAY).length;
    return { days_7: within(7), days_30: within(30) };
}

/** Accounts on each plan, internal apart. */
export function plan_counts(rows: AccountRow[]): Record<AdminPlan, number> {
    const out = { FREE: 0, STARTER: 0, PRO: 0, INTERNAL: 0 } as Record<AdminPlan, number>;
    rows.forEach(r => (out[r.plan] = (out[r.plan] || 0) + 1));
    return out;
}

export interface E2eResult {
    // success, failure, cancelled... or unknown when GitHub couldn't be read
    conclusion: string;
    at: number | null;
    url: string | null;
}

/** The latest finished run of the production E2E test, from GitHub's workflow runs API. */
export function e2e_result(body: any): E2eResult {
    const run = body && Array.isArray(body.workflow_runs) ? body.workflow_runs[0] : null;
    if (!run) return { conclusion: 'unknown', at: null, url: null };
    const at = Date.parse(run.updated_at || run.created_at || '');
    const url = typeof run.html_url === 'string' ? run.html_url : null;
    return {
        conclusion:
            typeof run.conclusion === 'string' && run.conclusion ? run.conclusion : 'unknown',
        at: Number.isFinite(at) ? at : null,
        url: url && url.startsWith('https://github.com/') ? url : null
    };
}
