import {
    LIVE_STATUSES,
    PRICE_LOOKUP_KEYS,
    all_lookup_keys,
    billing_state,
    checkout_account_id,
    event_customer,
    parse_checkout_request,
    plan_of_lookup_key
} from './billing';

const sub = (id: string, status: string, key: string | null, extra: any = {}) => ({
    id,
    status,
    created: 100,
    cancel_at_period_end: false,
    items: { data: [{ price: { lookup_key: key }, current_period_end: 2000 }] },
    ...extra
});

describe('billing rules', () => {
    it('has a distinct lookup key for each plan and interval', () => {
        const keys = all_lookup_keys();
        expect(keys).toHaveLength(4);
        expect(new Set(keys).size).toBe(4);
        for (const key of keys) expect(plan_of_lookup_key(key)).not.toBeNull();
        expect(plan_of_lookup_key(PRICE_LOOKUP_KEYS.PRO.year)).toEqual({
            plan: 'PRO',
            interval: 'year'
        });
        expect(plan_of_lookup_key('something_else')).toBeNull();
        expect(plan_of_lookup_key(null)).toBeNull();
    });

    it('accepts only plans and intervals that are sold', () => {
        expect(parse_checkout_request({ plan: 'starter', interval: 'year' })).toEqual({
            plan: 'STARTER',
            interval: 'year'
        });
        expect(parse_checkout_request({ plan: 'PRO' })).toEqual({ plan: 'PRO', interval: 'month' });
        expect(parse_checkout_request({ plan: 'FREE' })).toBeNull();
        expect(parse_checkout_request({ plan: 'PRO', interval: 'week' })).toBeNull();
        expect(parse_checkout_request(null)).toBeNull();
    });

    it('is Free with no subscription, or only ended ones', () => {
        expect(billing_state([]).plan).toBe('FREE');
        const s = billing_state([
            sub('a', 'canceled', PRICE_LOOKUP_KEYS.PRO.month),
            sub('b', 'incomplete_expired', PRICE_LOOKUP_KEYS.PRO.month),
            sub('c', 'paused', PRICE_LOOKUP_KEYS.STARTER.month)
        ]);
        expect(s).toMatchObject({ plan: 'FREE', subscription_id: null, pending: false });
    });

    it('gives the plan of an active or trialing subscription', () => {
        expect(billing_state([sub('a', 'active', PRICE_LOOKUP_KEYS.STARTER.year)])).toEqual({
            plan: 'STARTER',
            interval: 'year',
            subscription_id: 'a',
            status: 'active',
            failing: false,
            cancel_at_period_end: false,
            current_period_end: 2000,
            pending: false
        });
        expect(billing_state([sub('a', 'trialing', PRICE_LOOKUP_KEYS.PRO.month)]).plan).toBe('PRO');
    });

    it('keeps the plan of a failing subscription, marked failing', () => {
        for (const status of ['past_due', 'unpaid']) {
            const s = billing_state([sub('a', status, PRICE_LOOKUP_KEYS.PRO.month)]);
            expect(s).toMatchObject({ plan: 'PRO', failing: true, status });
        }
    });

    it('changes nothing while only a first payment is pending', () => {
        const s = billing_state([sub('a', 'incomplete', PRICE_LOOKUP_KEYS.PRO.month)]);
        expect(s).toMatchObject({ plan: 'FREE', pending: true });
    });

    it('ignores subscriptions to prices that are no plan', () => {
        const s = billing_state([sub('a', 'active', 'some_addon')]);
        expect(s.plan).toBe('FREE');
        expect(s.pending).toBe(false);
    });

    it('finds the plan item among several items', () => {
        const s = billing_state([
            {
                id: 'a',
                status: 'active',
                items: {
                    data: [
                        { price: { lookup_key: 'ai_addon' } },
                        { price: { lookup_key: PRICE_LOOKUP_KEYS.PRO.month } }
                    ]
                }
            }
        ]);
        expect(s.plan).toBe('PRO');
    });

    it('prefers a paid subscription, then the higher plan, then the newer', () => {
        const failing_pro = sub('pro', 'past_due', PRICE_LOOKUP_KEYS.PRO.month);
        const paid_starter = sub('starter', 'active', PRICE_LOOKUP_KEYS.STARTER.month);
        expect(billing_state([failing_pro, paid_starter]).subscription_id).toBe('starter');
        const paid_pro = sub('pro2', 'active', PRICE_LOOKUP_KEYS.PRO.month);
        expect(billing_state([paid_starter, paid_pro]).subscription_id).toBe('pro2');
        const older = sub('old', 'active', PRICE_LOOKUP_KEYS.PRO.month, { created: 1 });
        const newer = sub('new', 'active', PRICE_LOOKUP_KEYS.PRO.month, { created: 9 });
        expect(billing_state([older, newer]).subscription_id).toBe('new');
    });

    it('says when a cancelled subscription still runs to the period end', () => {
        const s = billing_state([
            sub('a', 'active', PRICE_LOOKUP_KEYS.PRO.month, { cancel_at_period_end: true })
        ]);
        expect(s).toMatchObject({ plan: 'PRO', cancel_at_period_end: true });
    });

    it('counts every status that can still charge as live', () => {
        for (const s of ['active', 'trialing', 'past_due', 'unpaid', 'incomplete']) {
            expect(LIVE_STATUSES.has(s)).toBe(true);
        }
        for (const s of ['canceled', 'incomplete_expired', 'paused']) {
            expect(LIVE_STATUSES.has(s)).toBe(false);
        }
    });

    it('reads the customer of the billing events only', () => {
        const e = (type: string, customer: any) => ({ type, data: { object: { customer } } });
        expect(event_customer(e('customer.subscription.updated', 'cus_1'))).toBe('cus_1');
        expect(event_customer(e('invoice.payment_failed', { id: 'cus_2' }))).toBe('cus_2');
        expect(event_customer(e('charge.refunded', 'cus_1'))).toBeNull();
        expect(event_customer(e('invoice.paid', null))).toBeNull();
    });

    it("reads a Checkout session's account id", () => {
        expect(checkout_account_id({ client_reference_id: '12' })).toBe(12);
        expect(checkout_account_id({ metadata: { account_id: '7' } })).toBe(7);
        expect(checkout_account_id({ client_reference_id: 'x' })).toBeNull();
        expect(checkout_account_id({ client_reference_id: '-3' })).toBeNull();
        expect(checkout_account_id(null)).toBeNull();
    });
});
