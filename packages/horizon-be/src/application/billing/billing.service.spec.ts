import Stripe from 'stripe';
import { BillingService } from './billing.service';
import { PRICE_LOOKUP_KEYS } from '@app/core/billing/billing';
import { PLAN_SUBSCRIPTIONS } from '@app/core/plan/plans';
import env from '@app/env';

// The real ones pull in modules Jest can't load; the tests hand in fakes
jest.mock('../plan/plan-state.service', () => ({ PlanStateService: class {} }));
jest.mock('../account/account.service', () => ({ AccountService: class {} }));

const SECRET = 'whsec_unit_test_secret';
const NOW = Date.UTC(2026, 10, 26, 12);
// Only used to sign test events locally: no network
const signer = new Stripe('sk_test_unit');

function make_account_repo(rows: any[]) {
    const matches = (r: any, where: any) =>
        Object.entries(where).every(([k, v]: [string, any]) =>
            v && typeof v === 'object' && v._type === 'isNull' ? r[k] == null : r[k] === v
        );
    return {
        rows,
        findOneBy: jest.fn(async (where: any) => {
            const r = rows.find(x => matches(x, where));
            return r ? { ...r } : null;
        }),
        update: jest.fn(async ({ id }, changes) => {
            const r = rows.find(x => x.id === id);
            if (r) Object.assign(r, changes);
        })
    };
}

function make_event_repo() {
    const ids = new Set<string>();
    return {
        ids,
        insert: jest.fn(async ({ id }) => {
            if (ids.has(id)) throw Object.assign(new Error('duplicate'), { code: '23505' });
            ids.add(id);
        }),
        delete: jest.fn(async ({ id }) => {
            ids.delete(id);
        })
    };
}

const account = (extra: any = {}) => ({
    id: 1,
    email: 'user1@example.com',
    email_verified: true,
    subscription_id: PLAN_SUBSCRIPTIONS.FREE,
    deleted: false,
    internal: false,
    plan_state: 'active',
    grace_ends_at: null,
    stripe_customer_id: null,
    stripe_subscription_id: null,
    ...extra
});

const sub = (id: string, status: string, key = PRICE_LOOKUP_KEYS.PRO.month, extra: any = {}) => ({
    id,
    status,
    created: 100,
    cancel_at_period_end: false,
    items: { data: [{ price: { lookup_key: key }, current_period_end: 2000 }] },
    ...extra
});

function fake_stripe(state: { subs: any[] }) {
    return {
        webhooks: signer.webhooks,
        subscriptions: {
            list: jest.fn(async () => ({ data: state.subs })),
            cancel: jest.fn(async (id: string) => {
                const s = state.subs.find(x => x.id === id);
                if (s) s.status = 'canceled';
                return s;
            })
        },
        customers: {
            create: jest.fn(async () => ({ id: 'cus_new' })),
            retrieve: jest.fn(async () => ({ id: 'cus_x', metadata: {} }))
        },
        prices: {
            list: jest.fn(async ({ lookup_keys }) => ({
                data: [{ id: `price_${lookup_keys[0]}` }]
            }))
        },
        checkout: {
            sessions: {
                create: jest.fn(async (_args: any) => ({ url: 'https://checkout.example/s' })),
                list: jest.fn(async () => ({ data: [{ id: 'cs_open' }] })),
                expire: jest.fn(async () => ({}))
            }
        },
        billingPortal: {
            sessions: { create: jest.fn(async () => ({ url: 'https://portal.example/p' })) }
        }
    };
}

function setup(rows: any[], subs: any[] = []) {
    const accounts = make_account_repo(rows);
    const events = make_event_repo();
    const state = { subs };
    const stripe = fake_stripe(state);
    const plan_state = {
        start_grace: jest.fn(async (id: number) => {
            const r = rows.find(x => x.id === id);
            Object.assign(r, { plan_state: 'grace', grace_ends_at: new Date(NOW + 14 * 86400e3) });
            return 'grace';
        }),
        refresh: jest.fn(async () => ({ state: 'active', over: [], changed: false })),
        set_grace_ended_listener: jest.fn()
    };
    const account_service = { set_before_delete: jest.fn() };
    const service = new BillingService(
        accounts as any,
        events as any,
        plan_state as any,
        account_service as any,
        stripe as any
    );
    service.now = () => NOW;
    service.onModuleInit();
    return { service, accounts, events, stripe, state, plan_state, account_service };
}

let event_n = 0;
function signed(type: string, object: any, id = `evt_${++event_n}`) {
    const payload = JSON.stringify({ id, type, object: 'event', created: 1, data: { object } });
    const header = signer.webhooks.generateTestHeaderString({ payload, secret: SECRET });
    return { body: Buffer.from(payload), header };
}

const outcome = (p: Promise<unknown>): Promise<any> =>
    p.then(
        v => v,
        e => e
    );

describe('BillingService', () => {
    beforeEach(() => {
        env.STRIPE_WEBHOOK_SECRET = SECRET;
    });

    describe('webhook', () => {
        it('refuses a missing, bad, or wrongly signed signature', async () => {
            const s = setup([account({ stripe_customer_id: 'cus_1' })]);
            const { body, header } = signed('customer.subscription.updated', {
                customer: 'cus_1'
            });
            expect((await outcome(s.service.handle_webhook(body, undefined))).status).toBe(400);
            expect((await outcome(s.service.handle_webhook(body, 't=1,v1=bad'))).status).toBe(400);
            const tampered = Buffer.from(body.toString().replace('cus_1', 'cus_2'));
            expect((await outcome(s.service.handle_webhook(tampered, header))).status).toBe(400);
            const other = signer.webhooks.generateTestHeaderString({
                payload: body.toString(),
                secret: 'whsec_other'
            });
            expect((await outcome(s.service.handle_webhook(body, other))).status).toBe(400);
            expect(s.events.insert).not.toHaveBeenCalled();
            expect(s.stripe.subscriptions.list).not.toHaveBeenCalled();
        });

        it('answers 503 without a signing secret', async () => {
            const s = setup([account()]);
            env.STRIPE_WEBHOOK_SECRET = undefined;
            const { body, header } = signed('invoice.paid', { customer: 'cus_1' });
            expect((await outcome(s.service.handle_webhook(body, header))).status).toBe(503);
        });

        it('puts the account on the plan its subscription is for', async () => {
            const rows = [account({ stripe_customer_id: 'cus_1' })];
            const s = setup(rows, [sub('sub_1', 'active', PRICE_LOOKUP_KEYS.STARTER.year)]);
            const { body, header } = signed('customer.subscription.created', {
                customer: 'cus_1'
            });
            expect(await s.service.handle_webhook(body, header)).toEqual({ received: true });
            expect(rows[0]).toMatchObject({
                subscription_id: PLAN_SUBSCRIPTIONS.STARTER,
                stripe_subscription_id: 'sub_1'
            });
            expect(s.plan_state.refresh).toHaveBeenCalledWith(1);
        });

        it('does nothing for an event it has handled already', async () => {
            const rows = [account({ stripe_customer_id: 'cus_1' })];
            const s = setup(rows, [sub('sub_1', 'active')]);
            const { body, header } = signed('invoice.paid', { customer: 'cus_1' }, 'evt_same');
            await s.service.handle_webhook(body, header);
            const again = await s.service.handle_webhook(body, header);
            expect(again).toEqual({ received: true, duplicate: true });
            expect(s.stripe.subscriptions.list).toHaveBeenCalledTimes(1);
        });

        it('forgets an event it failed to apply, so Stripe can send it again', async () => {
            const rows = [account({ stripe_customer_id: 'cus_1' })];
            const s = setup(rows, [sub('sub_1', 'active')]);
            s.stripe.subscriptions.list.mockRejectedValueOnce(new Error('Stripe down'));
            const { body, header } = signed('invoice.paid', { customer: 'cus_1' }, 'evt_retry');
            expect(await outcome(s.service.handle_webhook(body, header))).toBeInstanceOf(Error);
            expect(s.events.ids.has('evt_retry')).toBe(false);
            expect(await s.service.handle_webhook(body, header)).toEqual({ received: true });
            expect(rows[0].subscription_id).toBe(PLAN_SUBSCRIPTIONS.PRO);
        });

        it('ends on the same plan whatever order the events come in', async () => {
            // The subscription was cancelled; an older "updated" event arrives after the
            // "deleted" one: both read Stripe's current state, so the account stays on Free
            const rows = [
                account({
                    stripe_customer_id: 'cus_1',
                    stripe_subscription_id: 'sub_1',
                    subscription_id: PLAN_SUBSCRIPTIONS.PRO
                })
            ];
            const s = setup(rows, [sub('sub_1', 'canceled')]);
            for (const type of ['customer.subscription.deleted', 'customer.subscription.updated']) {
                const { body, header } = signed(type, { customer: 'cus_1' });
                await s.service.handle_webhook(body, header);
                expect(rows[0].subscription_id).toBe(PLAN_SUBSCRIPTIONS.FREE);
            }
            expect(rows[0].stripe_subscription_id).toBeNull();
            expect(rows[0].idle_clock_at).toEqual(new Date(NOW));
        });

        it('applies events that arrive at once one after the other', async () => {
            const rows = [account({ stripe_customer_id: 'cus_1' })];
            const s = setup(rows, [sub('sub_1', 'active')]);
            const a = signed('customer.subscription.created', { customer: 'cus_1' });
            const b = signed('invoice.paid', { customer: 'cus_1' });
            await Promise.all([
                s.service.handle_webhook(a.body, a.header),
                s.service.handle_webhook(b.body, b.header)
            ]);
            expect(rows[0].subscription_id).toBe(PLAN_SUBSCRIPTIONS.PRO);
        });

        it('ignores events about other things, and customers with no account', async () => {
            const rows = [account({ stripe_customer_id: 'cus_1' })];
            const s = setup(rows, [sub('sub_1', 'active')]);
            const a = signed('charge.refunded', { customer: 'cus_1' });
            await s.service.handle_webhook(a.body, a.header);
            const b = signed('invoice.paid', { customer: 'cus_unknown' });
            await s.service.handle_webhook(b.body, b.header);
            expect(s.stripe.subscriptions.list).not.toHaveBeenCalled();
            expect(rows[0].subscription_id).toBe(PLAN_SUBSCRIPTIONS.FREE);
        });

        it('links a customer to its account from the Checkout session', async () => {
            const rows = [account()];
            const s = setup(rows, [sub('sub_1', 'active')]);
            const { body, header } = signed('checkout.session.completed', {
                customer: 'cus_9',
                client_reference_id: '1'
            });
            await s.service.handle_webhook(body, header);
            expect(rows[0]).toMatchObject({
                stripe_customer_id: 'cus_9',
                subscription_id: PLAN_SUBSCRIPTIONS.PRO
            });
        });

        it("doesn't take over an account that already has another customer", async () => {
            const rows = [account({ stripe_customer_id: 'cus_mine' })];
            const s = setup(rows, [sub('sub_1', 'active')]);
            const { body, header } = signed('checkout.session.completed', {
                customer: 'cus_other',
                client_reference_id: '1'
            });
            await s.service.handle_webhook(body, header);
            expect(rows[0]).toMatchObject({
                stripe_customer_id: 'cus_mine',
                subscription_id: PLAN_SUBSCRIPTIONS.FREE
            });
        });
    });

    describe('sync', () => {
        it('starts a grace period when a payment fails, keeping the plan', async () => {
            const rows = [account({ stripe_customer_id: 'cus_1' })];
            const s = setup(rows, [sub('sub_1', 'past_due')]);
            await s.service.sync(1);
            expect(rows[0].subscription_id).toBe(PLAN_SUBSCRIPTIONS.PRO);
            expect(s.plan_state.start_grace).toHaveBeenCalledWith(1);
            // A second failure doesn't start the 14 days again
            await s.service.sync(1);
            expect(s.plan_state.start_grace).toHaveBeenCalledTimes(1);
        });

        it('ends the grace period when the payment goes through', async () => {
            const rows = [
                account({
                    stripe_customer_id: 'cus_1',
                    plan_state: 'grace',
                    grace_ends_at: new Date(NOW + 86400e3)
                })
            ];
            const s = setup(rows, [sub('sub_1', 'active')]);
            await s.service.sync(1);
            expect(rows[0]).toMatchObject({ plan_state: 'active', grace_ends_at: null });
        });

        it('leaves a plan an admin set alone when there is no Stripe subscription', async () => {
            const rows = [
                account({ stripe_customer_id: 'cus_1', subscription_id: PLAN_SUBSCRIPTIONS.PRO })
            ];
            const s = setup(rows, []);
            await s.service.sync(1);
            expect(rows[0].subscription_id).toBe(PLAN_SUBSCRIPTIONS.PRO);
            expect(s.plan_state.refresh).not.toHaveBeenCalled();
        });

        it('changes nothing while the first payment is pending', async () => {
            const rows = [account({ stripe_customer_id: 'cus_1' })];
            const s = setup(rows, [sub('sub_1', 'incomplete')]);
            await s.service.sync(1);
            expect(rows[0].subscription_id).toBe(PLAN_SUBSCRIPTIONS.FREE);
            expect(s.accounts.update).not.toHaveBeenCalled();
        });

        it('follows a change of plan made in the portal', async () => {
            const rows = [
                account({
                    stripe_customer_id: 'cus_1',
                    stripe_subscription_id: 'sub_1',
                    subscription_id: PLAN_SUBSCRIPTIONS.PRO
                })
            ];
            const s = setup(rows, [sub('sub_1', 'active', PRICE_LOOKUP_KEYS.STARTER.month)]);
            await s.service.sync(1);
            expect(rows[0].subscription_id).toBe(PLAN_SUBSCRIPTIONS.STARTER);
            expect(s.plan_state.refresh).toHaveBeenCalledWith(1);
        });
    });

    describe('checkout', () => {
        it('makes a Stripe customer only at the first Checkout', async () => {
            const rows = [account()];
            const s = setup(rows);
            const res = await s.service.checkout(1, { plan: 'STARTER', interval: 'year' });
            expect(res).toEqual({ url: 'https://checkout.example/s' });
            expect(s.stripe.customers.create).toHaveBeenCalledTimes(1);
            expect(rows[0].stripe_customer_id).toBe('cus_new');
            const args = s.stripe.checkout.sessions.create.mock.calls[0][0];
            expect(args).toMatchObject({
                mode: 'subscription',
                customer: 'cus_new',
                client_reference_id: '1',
                line_items: [{ price: `price_${PRICE_LOOKUP_KEYS.STARTER.year}`, quantity: 1 }]
            });
            await s.service.checkout(1, { plan: 'PRO' });
            expect(s.stripe.customers.create).toHaveBeenCalledTimes(1);
            // The second one expired the Checkout left open
            expect(s.stripe.checkout.sessions.expire).toHaveBeenCalledWith('cs_open');
        });

        it('refuses a second plan while one can still charge', async () => {
            for (const status of ['active', 'past_due', 'incomplete']) {
                const s = setup([account({ stripe_customer_id: 'cus_1' })], [sub('a', status)]);
                const err = await outcome(s.service.checkout(1, { plan: 'PRO' }));
                expect(err.status).toBe(409);
                expect(s.stripe.checkout.sessions.create).not.toHaveBeenCalled();
            }
        });

        it('refuses a plan that is not sold, an internal account, and no setup', async () => {
            const s = setup([account(), account({ id: 2, internal: true })]);
            expect((await outcome(s.service.checkout(1, { plan: 'FREE' }))).status).toBe(400);
            expect((await outcome(s.service.checkout(2, { plan: 'PRO' }))).status).toBe(400);
            env.STRIPE_WEBHOOK_SECRET = undefined;
            expect((await outcome(s.service.checkout(1, { plan: 'PRO' }))).status).toBe(503);
            expect(s.stripe.customers.create).not.toHaveBeenCalled();
        });

        it('answers 503 when Stripe has no price for the plan', async () => {
            const s = setup([account()]);
            s.stripe.prices.list.mockResolvedValueOnce({ data: [] });
            expect((await outcome(s.service.checkout(1, { plan: 'PRO' }))).status).toBe(503);
            expect(s.stripe.customers.create).not.toHaveBeenCalled();
        });
    });

    describe('status and portal', () => {
        it('needs no Stripe customer for a free account', async () => {
            const s = setup([account()]);
            const st = await s.service.status(1);
            expect(st).toMatchObject({
                enabled: true,
                plan: 'FREE',
                can_buy: true,
                has_billing_account: false,
                subscription: null
            });
            expect(s.stripe.subscriptions.list).not.toHaveBeenCalled();
            expect((await outcome(s.service.portal(1))).status).toBe(400);
        });

        it("shows the account's subscription and opens the portal", async () => {
            const rows = [account({ stripe_customer_id: 'cus_1' })];
            const s = setup(rows, [sub('sub_1', 'active', PRICE_LOOKUP_KEYS.PRO.year)]);
            const st = await s.service.status(1);
            expect(st.subscription).toMatchObject({
                plan: 'PRO',
                interval: 'year',
                status: 'active',
                current_period_end: 2000
            });
            expect(await s.service.portal(1)).toEqual({ url: 'https://portal.example/p' });
        });

        it('is off without Stripe', async () => {
            const s = setup([account()]);
            env.STRIPE_WEBHOOK_SECRET = undefined;
            expect(await s.service.status(1)).toMatchObject({ enabled: false, can_buy: false });
        });
    });

    describe('cancelling', () => {
        it("cancels every subscription that can still charge before the account's deleted", async () => {
            const rows = [account({ stripe_customer_id: 'cus_1', stripe_subscription_id: 'a' })];
            const s = setup(rows, [sub('a', 'active'), sub('b', 'past_due'), sub('c', 'canceled')]);
            const before_delete = s.account_service.set_before_delete.mock.calls[0][0];
            await before_delete(1);
            expect(s.stripe.subscriptions.cancel.mock.calls.map(c => c[0])).toEqual(['a', 'b']);
            expect(s.stripe.checkout.sessions.expire).toHaveBeenCalledWith('cs_open');
        });

        it('does nothing for an account that never paid', async () => {
            const s = setup([account()]);
            await s.service.cancel_subscriptions(1);
            expect(s.stripe.subscriptions.list).not.toHaveBeenCalled();
        });

        it('refuses the deletion when a paying account cannot be cancelled', async () => {
            const rows = [account({ stripe_customer_id: 'cus_1', stripe_subscription_id: 'a' })];
            const s = setup(rows);
            const off = new BillingService(
                s.accounts as any,
                s.events as any,
                s.plan_state as any,
                s.account_service as any,
                null
            );
            expect((await outcome(off.cancel_subscriptions(1))).status).toBe(503);
        });

        it('cancels the subscription when the grace period ends', async () => {
            const rows = [account({ stripe_customer_id: 'cus_1', stripe_subscription_id: 'a' })];
            const s = setup(rows, [sub('a', 'past_due')]);
            const listener = s.plan_state.set_grace_ended_listener.mock.calls[0][0];
            await listener(1);
            expect(s.stripe.subscriptions.cancel).toHaveBeenCalledWith('a');
        });
    });
});
