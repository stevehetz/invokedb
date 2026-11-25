// Plans and their caps (#129). The account's `plan` column says which one applies; Stripe
// webhooks are the only thing that moves an account between `free` and `pro`.
//
// The numbers are PLACEHOLDERS until the pricing review (#137) decides them. Each free cap can
// be overridden from the env (HORIZON_FREE_MAX_*), which the smoke test uses to make the caps
// small enough to hit.
import env from '@app/env';

export type PlanId = 'free' | 'pro' | 'internal';

export interface PlanLimits {
    // Tables (files) in the account
    max_tables: number;
    // Rows in one table
    max_rows: number;
    // Calls to the external API (/api/v1) per calendar month (UTC)
    max_api_calls_per_month: number;
}

export interface Plan {
    id: PlanId;
    name: string;
    limits: PlanLimits;
}

function int_or(value: string | undefined, fallback: number): number {
    const n = parseInt(value ?? '', 10);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export function get_plans(): Record<PlanId, Plan> {
    return {
        free: {
            id: 'free',
            name: 'Free',
            limits: {
                max_tables: int_or(env.HORIZON_FREE_MAX_TABLES, 3),
                max_rows: int_or(env.HORIZON_FREE_MAX_ROWS, 1000),
                max_api_calls_per_month: int_or(env.HORIZON_FREE_MAX_API_CALLS, 1000)
            }
        },
        pro: {
            id: 'pro',
            name: 'Pro',
            limits: { max_tables: 100, max_rows: 100000, max_api_calls_per_month: 100000 }
        },
        // The demo accounts and the production E2E test account (set by a migration); never sold
        internal: {
            id: 'internal',
            name: 'Internal',
            limits: { max_tables: 1000, max_rows: 1000000, max_api_calls_per_month: 10000000 }
        }
    };
}

export function get_plan(plan_id: string | null | undefined): Plan {
    const plans = get_plans();
    return plans[plan_id as PlanId] ?? plans.free;
}

// Stripe subscription status → the plan it gives. `past_due` keeps the paid plan while Stripe
// retries the card; a subscription that ends (canceled, unpaid, incomplete_expired) or never
// started (incomplete) falls back to free, and anything over the free caps turns read-only.
export function plan_for_subscription_status(status: string | null | undefined): PlanId {
    switch (status) {
        case 'active':
        case 'trialing':
        case 'past_due':
            return 'pro';
        default:
            return 'free';
    }
}

// `YYYY-MM` (UTC), the key the monthly API call counter is stored under
export function usage_month(date = new Date()): string {
    return date.toISOString().slice(0, 7);
}
