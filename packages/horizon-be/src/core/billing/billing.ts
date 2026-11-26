// Billing through Stripe (#129): the pure rules. Which Stripe price is which plan (by the price's
// lookup key, so no price id is configured anywhere), and what an account's plan is from the
// subscriptions Stripe holds for its customer. No I/O; unit-tested in billing.spec.ts.
// BillingService (application/billing) does the calls.
import { PlanId } from '../plan/plans';

export type BillingInterval = 'month' | 'year';
export const BILLING_INTERVALS: BillingInterval[] = ['month', 'year'];

// The plans that can be bought
export type PaidPlanId = Exclude<PlanId, 'FREE'>;
export const PAID_PLAN_IDS: PaidPlanId[] = ['STARTER', 'PRO'];

// Each price's lookup key in Stripe (Product catalog → the price → Lookup key). The owner sets
// these four once per mode (test and live); the code finds the prices by them.
export const PRICE_LOOKUP_KEYS: Record<PaidPlanId, Record<BillingInterval, string>> = {
    STARTER: { month: 'invokedb_starter_month', year: 'invokedb_starter_year' },
    PRO: { month: 'invokedb_pro_month', year: 'invokedb_pro_year' }
};

export function all_lookup_keys(): string[] {
    return PAID_PLAN_IDS.flatMap(p => BILLING_INTERVALS.map(i => PRICE_LOOKUP_KEYS[p][i]));
}

/** The plan and interval of a price's lookup key, or null for any other price. */
export function plan_of_lookup_key(
    key: string | null | undefined
): { plan: PaidPlanId; interval: BillingInterval } | null {
    if (!key) return null;
    for (const plan of PAID_PLAN_IDS) {
        for (const interval of BILLING_INTERVALS) {
            if (PRICE_LOOKUP_KEYS[plan][interval] === key) return { plan, interval };
        }
    }
    return null;
}

/** A Checkout request's plan and interval, checked; null when either isn't one we sell. */
export function parse_checkout_request(
    body: any
): { plan: PaidPlanId; interval: BillingInterval } | null {
    const plan = String(body?.plan || '').toUpperCase() as PaidPlanId;
    const interval = String(body?.interval || 'month').toLowerCase() as BillingInterval;
    if (!PAID_PLAN_IDS.includes(plan) || !BILLING_INTERVALS.includes(interval)) return null;
    return { plan, interval };
}

// Subscription statuses that give the plan. `past_due` and `unpaid` keep it too, but in a
// grace period (docs/PRICING.md 3.4): Stripe is retrying the card.
const PAID_STATUSES = new Set(['active', 'trialing']);
const FAILING_STATUSES = new Set(['past_due', 'unpaid']);
// Waiting for the first payment of a Checkout: not paid yet, but not over either
const PENDING_STATUSES = new Set(['incomplete']);

/**
 * Statuses that can still charge the customer: a second Checkout while one of these exists
 * would start a second subscription, and a deleted account must have them cancelled.
 */
export const LIVE_STATUSES = new Set([...PAID_STATUSES, ...FAILING_STATUSES, ...PENDING_STATUSES]);

// The parts of a Stripe subscription the rules read
export interface SubscriptionLike {
    id: string;
    status: string;
    cancel_at_period_end?: boolean | null;
    created?: number;
    items?: {
        data?: {
            price?: { lookup_key?: string | null } | null;
            current_period_end?: number | null;
        }[];
    } | null;
}

export interface BillingState {
    // The plan the subscriptions give (FREE when none does)
    plan: PlanId;
    interval: BillingInterval | null;
    // The subscription that gives it, or null
    subscription_id: string | null;
    // active, trialing, past_due, unpaid, or null (no paying subscription)
    status: string | null;
    // A failed payment Stripe is retrying: the plan is kept in a grace period
    failing: boolean;
    // Cancelled, but paid until the period's end
    cancel_at_period_end: boolean;
    // Unix seconds
    current_period_end: number | null;
    // Only an `incomplete` subscription (a Checkout's payment not done yet): change nothing
    pending: boolean;
}

function plan_item(sub: SubscriptionLike) {
    for (const item of sub.items?.data || []) {
        const p = plan_of_lookup_key(item?.price?.lookup_key);
        if (p) return { ...p, current_period_end: item.current_period_end ?? null };
    }
    return null;
}

const PLAN_RANK: Record<PlanId, number> = { FREE: 0, STARTER: 1, PRO: 2 };

/**
 * The account's plan from all its customer's subscriptions, as Stripe holds them now. Reading
 * the current state (rather than applying each event's change) makes the webhook safe against
 * events that arrive late, twice or at the same time. A paid subscription beats a failing one,
 * then the higher plan, then the newer.
 */
export function billing_state(subs: SubscriptionLike[]): BillingState {
    const candidates = (subs || [])
        .map(sub => ({ sub, item: plan_item(sub) }))
        .filter(
            c => c.item && (PAID_STATUSES.has(c.sub.status) || FAILING_STATUSES.has(c.sub.status))
        )
        .sort(
            (a, b) =>
                Number(PAID_STATUSES.has(b.sub.status)) - Number(PAID_STATUSES.has(a.sub.status)) ||
                PLAN_RANK[b.item.plan] - PLAN_RANK[a.item.plan] ||
                (b.sub.created || 0) - (a.sub.created || 0)
        );
    const best = candidates[0];
    if (!best) {
        const pending = (subs || []).some(s => PENDING_STATUSES.has(s.status) && plan_item(s));
        return {
            plan: 'FREE',
            interval: null,
            subscription_id: null,
            status: null,
            failing: false,
            cancel_at_period_end: false,
            current_period_end: null,
            pending
        };
    }
    return {
        plan: best.item.plan,
        interval: best.item.interval,
        subscription_id: best.sub.id,
        status: best.sub.status,
        failing: FAILING_STATUSES.has(best.sub.status),
        cancel_at_period_end: !!best.sub.cancel_at_period_end,
        current_period_end: best.item.current_period_end,
        pending: false
    };
}

// The webhook events that can change an account's plan; each one makes the account's plan be
// read again from Stripe
export const BILLING_EVENTS = [
    'checkout.session.completed',
    'customer.subscription.created',
    'customer.subscription.updated',
    'customer.subscription.deleted',
    'customer.subscription.paused',
    'customer.subscription.resumed',
    'invoice.paid',
    'invoice.payment_failed'
];

/** The Stripe customer id an event is about (`customer` on all of BILLING_EVENTS' objects). */
export function event_customer(event: { type: string; data?: { object?: any } }): string | null {
    if (!BILLING_EVENTS.includes(event?.type)) return null;
    const c = event.data?.object?.customer;
    if (!c) return null;
    return typeof c === 'string' ? c : c.id || null;
}

/** The account id a Checkout session was opened for (we set `client_reference_id`). */
export function checkout_account_id(session: any): number | null {
    const raw = session?.client_reference_id ?? session?.metadata?.account_id;
    const id = Number(raw);
    return Number.isInteger(id) && id > 0 ? id : null;
}
