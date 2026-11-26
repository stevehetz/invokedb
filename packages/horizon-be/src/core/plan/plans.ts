// The plans (docs/PRICING.md 3.2, decided 2026-11-25; #183): every cap of every tier, in one
// place. TrackingManager and the services enforce them, `GET /plans` serves them to the pricing
// page and `GET /usage` shows an account's use against them. Pure rules only (no I/O), unit-tested
// in plans.spec.ts. Nothing else may hard-code a plan's limit.
import { HttpException, HttpStatus } from '@nestjs/common';

export type PlanId = 'FREE' | 'STARTER' | 'PRO';
export const PLAN_IDS: PlanId[] = ['FREE', 'STARTER', 'PRO'];

export type SyncScheduleName = 'off' | 'hourly' | 'daily';

export interface AiCaps {
    // Questions per UTC month (#149)
    questions: number;
    // Generated rows per UTC month (#148)
    rows: number;
    // What the account's AI use may cost per month, in US dollars
    budget_usd: number;
}

export interface PlanCaps {
    tables: number;
    // All tables together
    rows_per_account: number;
    rows_per_table: number;
    // The account's Mongo database (`dbStats`), in bytes
    storage_bytes: number;
    columns_per_table: number;
    // `/api/v1` calls per UTC calendar month
    api_calls_per_month: number;
    // `/api/v1` calls per second for the whole account, and the burst it may take at once
    api_rate_per_second: number;
    api_rate_burst: number;
    // Rows in one `/api/v1` write, and in one `/api/v1/query` page
    rows_per_write: number;
    query_page: number;
    csv_upload_bytes: number;
    url_sources: number;
    // Which sync schedules a URL source may have
    url_sync_schedules: SyncScheduleName[];
    webhooks: number;
    forms: number;
    views_per_table: number;
    // How long the audit log (#217) keeps entries
    audit_keep_days: number;
    // API keys with their own rate limits, and their request logs (#216)
    key_limits_and_logs: boolean;
    ai: AiCaps;
}

export interface Plan {
    id: PlanId;
    name: string;
    // US dollars; null for Free
    price_month_usd: number | null;
    price_year_usd: number | null;
    caps: PlanCaps;
}

const MB = 1024 * 1024;
const GB = 1024 * MB;

export const PLANS: Record<PlanId, Plan> = {
    FREE: {
        id: 'FREE',
        name: 'Free',
        price_month_usd: null,
        price_year_usd: null,
        caps: {
            tables: 3,
            rows_per_account: 3000,
            rows_per_table: 1000,
            storage_bytes: 10 * MB,
            columns_per_table: 20,
            api_calls_per_month: 10000,
            api_rate_per_second: 2,
            api_rate_burst: 10,
            rows_per_write: 100,
            query_page: 100,
            csv_upload_bytes: 1 * MB,
            url_sources: 1,
            url_sync_schedules: ['off', 'daily'],
            webhooks: 1,
            forms: 1,
            views_per_table: 5,
            audit_keep_days: 7,
            key_limits_and_logs: false,
            ai: { questions: 10, rows: 50, budget_usd: 0.05 }
        }
    },
    STARTER: {
        id: 'STARTER',
        name: 'Starter',
        price_month_usd: 9,
        price_year_usd: 90,
        caps: {
            tables: 25,
            rows_per_account: 100000,
            rows_per_table: 100000,
            storage_bytes: 1 * GB,
            columns_per_table: 52,
            api_calls_per_month: 250000,
            api_rate_per_second: 10,
            api_rate_burst: 50,
            rows_per_write: 100,
            query_page: 1000,
            csv_upload_bytes: 25 * MB,
            url_sources: 5,
            url_sync_schedules: ['off', 'hourly', 'daily'],
            webhooks: 5,
            forms: 10,
            views_per_table: 50,
            audit_keep_days: 30,
            key_limits_and_logs: true,
            ai: { questions: 300, rows: 1000, budget_usd: 1 }
        }
    },
    PRO: {
        id: 'PRO',
        name: 'Pro',
        price_month_usd: 29,
        price_year_usd: 290,
        caps: {
            tables: 100,
            rows_per_account: 1000000,
            rows_per_table: 1000000,
            storage_bytes: 5 * GB,
            columns_per_table: 52,
            api_calls_per_month: 2000000,
            api_rate_per_second: 25,
            api_rate_burst: 100,
            rows_per_write: 100,
            query_page: 1000,
            csv_upload_bytes: 100 * MB,
            url_sources: 25,
            url_sync_schedules: ['off', 'hourly', 'daily'],
            webhooks: 10,
            forms: 50,
            views_per_table: 50,
            audit_keep_days: 90,
            key_limits_and_logs: true,
            ai: { questions: 2000, rows: 10000, budget_usd: 5 }
        }
    }
};

// Whatever the plan, an upload larger than this is cut off at the HTTP layer (multer), so a
// request can't fill the disk before the plan is checked
export const SERVER_MAX_UPLOAD_BYTES = 100 * MB;
// The most columns a table can have on any plan: column keys and the grid are built around it
export const MAX_COLUMNS = 52;

// The caps that count something an account has (tables, rows, calls...). An internal account
// has none of them; the size caps (columns, page, upload) and the features stay at Pro's.
export const COUNTED_CAPS = [
    'tables',
    'rows_per_account',
    'rows_per_table',
    'storage_bytes',
    'api_calls_per_month',
    'url_sources',
    'webhooks',
    'forms',
    'views_per_table'
] as const;
export type CountedCap = (typeof COUNTED_CAPS)[number];

// The owner's own accounts (the demo data and production's E2E test account, #90) aren't
// capped, so the smoke tests and the E2E run keep working. Only with a verified email, so an
// unverified sign-up can't pass for one.
export const INTERNAL_EMAILS = [
    'demo@invokedb.com',
    'demo2@invokedb.com',
    'demo3@invokedb.com',
    'demo4@invokedb.com',
    'demo5@invokedb.com',
    'demo6@invokedb.com',
    'demo7@invokedb.com',
    'e2e@invokedb.com'
];

// Until Stripe (#129) maps its prices to plans: today's subscription ids, without their
// SUB_TEST_ / SUB_LIVE_ prefix
const SUBSCRIPTION_PLANS: Record<string, PlanId> = {
    FREE: 'FREE',
    BASIC: 'STARTER',
    PLUS: 'PRO',
    PREMIUM: 'PRO'
};

/** A subscription id on each plan (the other way round from plan_id_of), for tests. */
export const PLAN_SUBSCRIPTIONS: Record<PlanId, string> = {
    FREE: 'SUB_FREE',
    STARTER: 'SUB_LIVE_BASIC',
    PRO: 'SUB_LIVE_PLUS'
};

/** The plan of a subscription id: SUB_FREE, SUB_TEST_PLUS, SUB_LIVE_BASIC... (none: Free) */
export function plan_id_of(subscription_id: string | null | undefined): PlanId {
    if (!subscription_id) return 'FREE';
    const plan = String(subscription_id)
        .replace(/^SUB_(TEST_|LIVE_)?/, '')
        .toUpperCase();
    return SUBSCRIPTION_PLANS[plan] || 'FREE';
}

export interface PlanAccount {
    email?: string | null;
    email_verified?: boolean | null;
    subscription_id?: string | null;
    // Put on no counted caps by an admin (#277)
    internal?: boolean | null;
}

export interface TestPlan {
    plan: PlanId;
    caps?: Partial<PlanCaps>;
}

/**
 * Test only: `HORIZON_TEST_PLANS` (scripts/smoke-env.sh sets it; never in production) puts
 * accounts on a plan by email, with some of its caps shrunk so the smoke test can reach them:
 * `{"demo7@invokedb.com": {"plan": "FREE", "caps": {"tables": 2}}}`. An account listed there
 * isn't internal. Anything that isn't valid is left out (and logged).
 */
export function parse_test_plans(value: string | undefined): Record<string, TestPlan> {
    if (!value || !value.trim()) return {};
    let parsed: any;
    try {
        parsed = JSON.parse(value);
    } catch (ex) {
        console.error(`HORIZON_TEST_PLANS is not JSON: ${ex.message}`);
        return {};
    }
    const out: Record<string, TestPlan> = {};
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return out;
    for (const [email, entry] of Object.entries<any>(parsed)) {
        if (!entry || !PLAN_IDS.includes(entry.plan)) {
            console.error(`HORIZON_TEST_PLANS: ${email} has no valid plan`);
            continue;
        }
        const caps: Partial<PlanCaps> = {};
        const given = entry.caps && typeof entry.caps === 'object' ? entry.caps : {};
        for (const [k, v] of Object.entries(given)) {
            if (k in PLANS.FREE.caps) (caps as any)[k] = v;
        }
        out[String(email).toLowerCase()] = { plan: entry.plan, caps };
    }
    return out;
}

let test_plans_cache: { raw: string | undefined; plans: Record<string, TestPlan> } | null = null;

function test_plans(): Record<string, TestPlan> {
    const raw = process.env.HORIZON_TEST_PLANS;
    if (!test_plans_cache || test_plans_cache.raw !== raw) {
        test_plans_cache = { raw, plans: parse_test_plans(raw) };
    }
    return test_plans_cache.plans;
}

export interface AccountPlan {
    plan: Plan;
    // Not capped (INTERNAL_EMAILS, or an admin's choice, #277): `caps` has Infinity for every
    // counted cap
    internal: boolean;
    caps: PlanCaps;
}

/** What an account may use: its plan, and the caps that apply to it. */
export function account_plan(
    account: PlanAccount | null | undefined,
    overrides: Record<string, TestPlan> = test_plans()
): AccountPlan {
    const email = String(account?.email || '').toLowerCase();
    const test = email ? overrides[email] : undefined;
    if (test) {
        const plan = PLANS[test.plan];
        return { plan, internal: false, caps: { ...plan.caps, ...test.caps } };
    }
    const plan = PLANS[plan_id_of(account?.subscription_id)];
    if (
        account?.internal === true ||
        (account?.email_verified === true && INTERNAL_EMAILS.includes(email))
    ) {
        const caps: PlanCaps = { ...PLANS.PRO.caps };
        COUNTED_CAPS.forEach(k => ((caps as any)[k] = Infinity));
        caps.api_rate_per_second = Infinity;
        caps.api_rate_burst = Infinity;
        return { plan, internal: true, caps };
    }
    return { plan, internal: false, caps: plan.caps };
}

// What each cap is called in a refusal: "Your plan (Free) allows 3 tables"
const CAP_LABELS: Record<string, (cap: any) => string> = {
    tables: n => `${fmt(n)} tables`,
    rows_per_account: n => `${fmt(n)} rows in all`,
    rows_per_table: n => `${fmt(n)} rows per table`,
    storage_bytes: n => `${fmt_bytes(n)} of storage`,
    columns_per_table: n => `${fmt(n)} columns per table`,
    api_calls_per_month: n => `${fmt(n)} API calls a month`,
    api_rate_per_second: n => `${fmt(n)} API calls a second`,
    csv_upload_bytes: n => `CSV uploads of up to ${fmt_bytes(n)}`,
    url_sources: n => `${fmt(n)} tables imported from a URL`,
    url_sync_schedules: (cap: string[]) =>
        `URL syncs ${cap.filter(s => s !== 'off').join(' or ')} only`,
    webhooks: n => `${fmt(n)} webhooks`,
    forms: n => `${fmt(n)} forms`,
    views_per_table: n => `${fmt(n)} views per table`,
    key_limits_and_logs: () => `no per-key rate limits or request logs`
};

export type PlanLimit = keyof typeof CAP_LABELS;

const fmt = (n: number) => n.toLocaleString('en-US');

export function fmt_bytes(n: number) {
    if (n >= GB && n % GB === 0) return `${n / GB} GB`;
    if (n >= MB) return `${Math.round((n / MB) * 10) / 10} MB`;
    if (n >= 1024) return `${Math.round((n / 1024) * 10) / 10} KB`;
    return `${n} bytes`;
}

// Where an upgrade is offered; the frontend's own URL when it's known
export function upgrade_url(fe_url: string | undefined = process.env.HORIZON_FE_PUB_HTTP_URL) {
    return `${(fe_url || '').replace(/\/$/, '')}/pricing`;
}

/** What a refusal at a cap says, and the body it carries (docs/PRICING.md 3.4). */
export function plan_limit_body(limit: PlanLimit, cap: number | string[], plan: Plan) {
    const label = CAP_LABELS[limit] ? CAP_LABELS[limit](cap) : `${cap} ${limit}`;
    return {
        message: `Your plan (${plan.name}) allows ${label}. Upgrade for more.`,
        code: 'plan_limit',
        limit,
        cap,
        plan: plan.id,
        upgrade_url: upgrade_url()
    };
}

/** A write over a cap: 403 with `plan_limit`, which limit, the cap and the upgrade link. */
export function plan_limit_error(
    limit: PlanLimit,
    cap: number | string[],
    plan: Plan,
    status = HttpStatus.FORBIDDEN
) {
    return new HttpException(plan_limit_body(limit, cap, plan), status);
}

/**
 * Refuses one more of a counted thing (webhooks, forms, views, URL sources) when the account
 * already has `current` of them and its plan allows no more.
 */
export function assert_room(account: PlanAccount, limit: CountedCap, current: number) {
    const { plan, caps } = account_plan(account);
    const cap = caps[limit] as number;
    if (current + 1 > cap) throw plan_limit_error(limit, cap, plan);
}

/** Refuses a URL sync schedule the plan doesn't allow (Free: daily only). */
export function assert_sync_schedule(account: PlanAccount, schedule: string) {
    const { plan, caps } = account_plan(account);
    if (!caps.url_sync_schedules.includes(schedule as SyncScheduleName)) {
        throw plan_limit_error('url_sync_schedules', caps.url_sync_schedules, plan);
    }
}

/** The plans as the public `GET /plans` serves them (and the pricing page shows them). */
export function public_plans() {
    return PLAN_IDS.map(id => PLANS[id]);
}

/** Seconds from `now` to the 1st of next month (UTC), when the monthly API quota resets. */
export function seconds_to_next_month(now: number) {
    const d = new Date(now);
    const next = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
    return Math.max(1, Math.ceil((next - now) / 1000));
}

/** The UTC month of a moment, "2026-11": the API quota's period. */
export function quota_month(now: number) {
    return new Date(now).toISOString().slice(0, 7);
}

/**
 * One cap and how much of it is used, for `GET /usage`. An internal account's caps are
 * Infinity, which goes out as null ("no cap").
 */
export function usage_item(used: number, cap: number) {
    return { used, cap: Number.isFinite(cap) ? cap : null };
}
