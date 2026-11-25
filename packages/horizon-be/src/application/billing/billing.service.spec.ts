import Stripe from 'stripe';
import { BillingService } from './billing.service';
import env from '@app/env';

// Stripe is mocked throughout: signatures are made locally with a test secret, and the API
// client is a fake that records its calls. No keys, no network.
const SECRET = 'whsec_unit_test';

function make_service({ stripe_enabled = true } = {}) {
    const accounts = new Map<number, any>();
    const events = new Set<string>();

    const account_repository = {
        findOneBy: jest.fn(async (where: any) => {
            for (const a of accounts.values()) {
                if (Object.keys(where).every(k => a[k] === where[k])) return { ...a };
            }
            return null;
        }),
        update: jest.fn(async (where: any, change: any) => {
            Object.assign(accounts.get(where.id), change);
        })
    };
    const stripe_event_repository = {
        insert: jest.fn(async (row: any) => {
            if (events.has(row.id)) throw Object.assign(new Error('dup'), { code: '23505' });
            events.add(row.id);
        }),
        delete: jest.fn(async (where: any) => {
            events.delete(where.id);
        })
    };
    const tracking_manager = {
        on_plan_change: jest.fn(async () => undefined),
        get_usage: jest.fn(async (account: any) => ({ plan: account.plan }))
    };
    const stripe = {
        customers: { create: jest.fn(async () => ({ id: 'cus_new' })) },
        checkout: {
            sessions: {
                create: jest.fn(async () => ({ url: 'https://checkout.test/s' })),
                list: jest.fn(async (_params?: any) => ({ data: [] as any[] })),
                expire: jest.fn(async (_id?: string) => ({}))
            }
        },
        subscriptions: { list: jest.fn(async (_params?: any) => ({ data: [] as any[] })) },
        billingPortal: {
            sessions: { create: jest.fn(async () => ({ url: 'https://portal.test/p' })) }
        }
    };

    const service = new BillingService(
        account_repository as any,
        stripe_event_repository as any,
        tracking_manager as any,
        (stripe_enabled ? stripe : null) as any
    );
    const add_account = (a: any) =>
        accounts.set(a.id, {
            plan: 'free',
            plan_status: null,
            plan_event_at: null,
            stripe_customer_id: null,
            stripe_subscription_id: null,
            email: `a${a.id}@x.test`,
            ...a
        });
    return {
        service,
        accounts,
        add_account,
        stripe,
        tracking_manager,
        stripe_event_repository
    };
}

let counter = 0;
function signed(type: string, object: any, { created = 1000, id = `evt_${++counter}` } = {}) {
    const payload = JSON.stringify({ id, type, created, object: 'event', data: { object } });
    const header = Stripe.webhooks.generateTestHeaderString({ payload, secret: SECRET });
    return { body: Buffer.from(payload), header, id };
}

function checkout_completed(account_id: number, extra: any = {}) {
    return {
        id: 'cs_1',
        object: 'checkout.session',
        mode: 'subscription',
        payment_status: 'paid',
        client_reference_id: String(account_id),
        customer: 'cus_1',
        subscription: 'sub_1',
        metadata: { account_id: String(account_id) },
        ...extra
    };
}

function subscription(status: string, extra: any = {}) {
    return {
        id: 'sub_1',
        object: 'subscription',
        status,
        customer: 'cus_1',
        metadata: { account_id: '1' },
        ...extra
    };
}

describe('BillingService webhook', () => {
    const saved = { ...env };
    beforeEach(() => {
        env.STRIPE_WEBHOOK_SECRET = SECRET;
        env.STRIPE_PRICE_ID = 'price_test';
    });
    afterEach(() => Object.assign(env, saved));

    it('answers 503 when the webhook secret is not set', async () => {
        env.STRIPE_WEBHOOK_SECRET = undefined;
        const { service } = make_service();
        const e = signed('checkout.session.completed', checkout_completed(1));
        await expect(service.handle_webhook(e.body, e.header)).rejects.toMatchObject({
            status: 503
        });
    });

    it('rejects a missing or bad signature and changes nothing', async () => {
        const { service, add_account, accounts } = make_service();
        add_account({ id: 1 });
        const e = signed('checkout.session.completed', checkout_completed(1));
        await expect(service.handle_webhook(e.body, undefined)).rejects.toMatchObject({
            status: 400
        });
        await expect(service.handle_webhook(e.body, 't=1,v1=deadbeef')).rejects.toMatchObject({
            status: 400
        });
        // Signed with another secret
        const forged = Stripe.webhooks.generateTestHeaderString({
            payload: e.body.toString(),
            secret: 'whsec_wrong'
        });
        await expect(service.handle_webhook(e.body, forged)).rejects.toMatchObject({
            status: 400
        });
        // A tampered body no longer matches its signature
        const tampered = Buffer.from(e.body.toString().replace('"1"', '"2"'));
        await expect(service.handle_webhook(tampered, e.header)).rejects.toMatchObject({
            status: 400
        });
        expect(accounts.get(1).plan).toBe('free');
    });

    it('upgrades the account on checkout.session.completed', async () => {
        const { service, add_account, accounts, tracking_manager } = make_service();
        add_account({ id: 1 });
        const e = signed('checkout.session.completed', checkout_completed(1));
        await expect(service.handle_webhook(e.body, e.header)).resolves.toEqual({
            received: true
        });
        expect(accounts.get(1)).toMatchObject({
            plan: 'pro',
            plan_status: 'active',
            stripe_customer_id: 'cus_1',
            stripe_subscription_id: 'sub_1',
            plan_event_at: '1000'
        });
        expect(tracking_manager.on_plan_change).toHaveBeenCalledWith(
            expect.objectContaining({ id: 1, plan: 'pro' })
        );
    });

    it('ignores a replayed event', async () => {
        const { service, add_account, accounts, tracking_manager } = make_service();
        add_account({ id: 1 });
        const e = signed('checkout.session.completed', checkout_completed(1));
        await service.handle_webhook(e.body, e.header);
        // The user cancels...
        const del = signed('customer.subscription.deleted', subscription('canceled'), {
            created: 2000
        });
        await service.handle_webhook(del.body, del.header);
        expect(accounts.get(1).plan).toBe('free');
        // ...and a replay of the old upgrade must not bring the paid plan back
        await expect(service.handle_webhook(e.body, e.header)).resolves.toEqual({
            received: true,
            duplicate: true
        });
        expect(accounts.get(1).plan).toBe('free');
        expect(tracking_manager.on_plan_change).toHaveBeenCalledTimes(2);
    });

    it('ignores an event older than the last one applied (out of order)', async () => {
        const { service, add_account, accounts } = make_service();
        add_account({ id: 1, plan: 'pro', stripe_subscription_id: 'sub_1' });
        const deleted = signed('customer.subscription.deleted', subscription('canceled'), {
            created: 2000
        });
        const stale = signed('customer.subscription.updated', subscription('active'), {
            created: 1500
        });
        await service.handle_webhook(deleted.body, deleted.header);
        await service.handle_webhook(stale.body, stale.header);
        expect(accounts.get(1)).toMatchObject({
            plan: 'free',
            plan_status: 'canceled',
            stripe_subscription_id: null,
            plan_event_at: '2000'
        });
    });

    it.each([
        ['active', 'pro'],
        ['trialing', 'pro'],
        ['past_due', 'pro'],
        ['unpaid', 'free'],
        ['canceled', 'free'],
        ['incomplete_expired', 'free']
    ])('customer.subscription.updated %s gives plan %s', async (status, plan) => {
        const { service, add_account, accounts } = make_service();
        add_account({ id: 1, plan: 'pro', stripe_subscription_id: 'sub_1' });
        const e = signed('customer.subscription.updated', subscription(status));
        await service.handle_webhook(e.body, e.header);
        expect(accounts.get(1)).toMatchObject({ plan, plan_status: status });
    });

    it('ignores an incomplete subscription sent in the same second as the checkout', async () => {
        const { service, add_account, accounts } = make_service();
        add_account({ id: 1 });
        const done = signed('checkout.session.completed', checkout_completed(1));
        const created = signed('customer.subscription.created', subscription('incomplete'));
        await service.handle_webhook(done.body, done.header);
        await service.handle_webhook(created.body, created.header);
        expect(accounts.get(1)).toMatchObject({ plan: 'pro', plan_status: 'active' });
    });

    it('finds the account by Stripe customer when the metadata is missing', async () => {
        const { service, add_account, accounts } = make_service();
        add_account({ id: 1, plan: 'pro', stripe_customer_id: 'cus_1' });
        const e = signed(
            'customer.subscription.deleted',
            subscription('canceled', { metadata: {} })
        );
        await service.handle_webhook(e.body, e.header);
        expect(accounts.get(1).plan).toBe('free');
    });

    it("ignores events about a subscription that isn't the account's current one", async () => {
        const { service, add_account, accounts } = make_service();
        add_account({ id: 1, plan: 'pro', stripe_subscription_id: 'sub_new' });
        const e = signed('customer.subscription.deleted', subscription('canceled'));
        await service.handle_webhook(e.body, e.header);
        expect(accounts.get(1)).toMatchObject({ plan: 'pro', stripe_subscription_id: 'sub_new' });
    });

    it('marks a paid account past_due on invoice.payment_failed, keeping the plan', async () => {
        const { service, add_account, accounts } = make_service();
        add_account({ id: 1, plan: 'pro', plan_status: 'active', stripe_customer_id: 'cus_1' });
        const e = signed('invoice.payment_failed', { id: 'in_1', customer: 'cus_1' });
        await service.handle_webhook(e.body, e.header);
        expect(accounts.get(1)).toMatchObject({ plan: 'pro', plan_status: 'past_due' });
    });

    it('never changes an internal account', async () => {
        const { service, add_account, accounts } = make_service();
        add_account({ id: 1, plan: 'internal' });
        const e = signed('customer.subscription.deleted', subscription('canceled'));
        await service.handle_webhook(e.body, e.header);
        expect(accounts.get(1).plan).toBe('internal');
    });

    it('ignores other event types and unknown accounts', async () => {
        const { service, add_account, accounts } = make_service();
        add_account({ id: 1 });
        const other = signed('customer.created', { id: 'cus_1' });
        const unknown = signed('checkout.session.completed', checkout_completed(99));
        await expect(service.handle_webhook(other.body, other.header)).resolves.toEqual({
            received: true
        });
        await expect(service.handle_webhook(unknown.body, unknown.header)).resolves.toEqual({
            received: true
        });
        expect(accounts.get(1).plan).toBe('free');
    });

    it('forgets the event when applying it fails, so a Stripe retry works', async () => {
        const { service, add_account, accounts, tracking_manager } = make_service();
        add_account({ id: 1 });
        tracking_manager.on_plan_change.mockRejectedValueOnce(new Error('mongo down'));
        const e = signed('checkout.session.completed', checkout_completed(1));
        await expect(service.handle_webhook(e.body, e.header)).rejects.toThrow('mongo down');
        accounts.get(1).plan_event_at = null;
        await expect(service.handle_webhook(e.body, e.header)).resolves.toEqual({
            received: true
        });
        expect(accounts.get(1).plan).toBe('pro');
    });
});

describe('BillingService Checkout and Portal', () => {
    const saved = { ...env };
    beforeEach(() => {
        env.STRIPE_PRICE_ID = 'price_test';
        env.HORIZON_FE_PUB_HTTP_URL = 'https://app.test';
    });
    afterEach(() => Object.assign(env, saved));

    it('answers 503 when Stripe is not set up', async () => {
        const { service, add_account } = make_service({ stripe_enabled: false });
        add_account({ id: 1 });
        expect(service.is_enabled()).toBe(false);
        await expect(service.create_checkout_session(1)).rejects.toMatchObject({ status: 503 });
        await expect(service.create_portal_session(1)).rejects.toMatchObject({ status: 503 });
        env.STRIPE_PRICE_ID = undefined;
        const s2 = make_service();
        expect(s2.service.is_enabled()).toBe(false);
    });

    it('a free account needs no Stripe customer', async () => {
        const { service, add_account, accounts, stripe } = make_service();
        add_account({ id: 1 });
        const status = await service.get_status(1);
        expect(status).toMatchObject({ billing_enabled: true, has_billing_account: false });
        expect(stripe.customers.create).not.toHaveBeenCalled();
        expect(accounts.get(1).stripe_customer_id).toBeNull();
    });

    it('creates the Stripe customer on the first Checkout, then reuses it', async () => {
        const { service, add_account, accounts, stripe } = make_service();
        add_account({ id: 1 });
        await expect(service.create_checkout_session(1)).resolves.toEqual({
            url: 'https://checkout.test/s'
        });
        expect(accounts.get(1).stripe_customer_id).toBe('cus_new');
        expect(stripe.checkout.sessions.create).toHaveBeenCalledWith(
            expect.objectContaining({
                mode: 'subscription',
                customer: 'cus_new',
                client_reference_id: '1',
                line_items: [{ price: 'price_test', quantity: 1 }],
                success_url: 'https://app.test/app/account?billing=success'
            })
        );
        // Checkout doesn't change the plan: only the webhook does
        expect(accounts.get(1).plan).toBe('free');
        await service.create_checkout_session(1);
        expect(stripe.customers.create).toHaveBeenCalledTimes(1);
    });

    it('refuses Checkout for an account already paying or internal', async () => {
        const { service, add_account } = make_service();
        add_account({ id: 1, plan: 'pro', stripe_subscription_id: 'sub_1' });
        add_account({ id: 2, plan: 'internal' });
        await expect(service.create_checkout_session(1)).rejects.toMatchObject({ status: 400 });
        await expect(service.create_checkout_session(2)).rejects.toMatchObject({ status: 400 });
    });

    it('refuses Checkout while Stripe has a live subscription the webhook has not applied', async () => {
        const { service, add_account, stripe } = make_service();
        add_account({ id: 1, stripe_customer_id: 'cus_1' });
        for (const status of ['active', 'trialing', 'past_due', 'incomplete', 'unpaid']) {
            stripe.subscriptions.list.mockResolvedValueOnce({ data: [{ id: 'sub_1', status }] });
            await expect(service.create_checkout_session(1)).rejects.toMatchObject({
                status: 400
            });
        }
        expect(stripe.subscriptions.list).toHaveBeenCalledWith({
            customer: 'cus_1',
            status: 'all',
            limit: 10
        });
        expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();
        // An ended subscription doesn't stop a new one
        stripe.subscriptions.list.mockResolvedValueOnce({
            data: [{ id: 'sub_0', status: 'canceled' }]
        });
        await expect(service.create_checkout_session(1)).resolves.toEqual({
            url: 'https://checkout.test/s'
        });
    });

    it('expires a Checkout still open in another tab before opening a new one', async () => {
        const { service, add_account, stripe } = make_service();
        add_account({ id: 1, stripe_customer_id: 'cus_1' });
        stripe.checkout.sessions.list.mockResolvedValueOnce({ data: [{ id: 'cs_old' }] });
        await service.create_checkout_session(1);
        expect(stripe.checkout.sessions.list).toHaveBeenCalledWith({
            customer: 'cus_1',
            status: 'open',
            limit: 10
        });
        expect(stripe.checkout.sessions.expire).toHaveBeenCalledWith('cs_old');
        expect(stripe.checkout.sessions.create).toHaveBeenCalledTimes(1);
    });

    it('logs a second paid Checkout and tracks the newer subscription', async () => {
        const { service, add_account, accounts } = make_service();
        add_account({ id: 1, plan: 'pro', stripe_subscription_id: 'sub_old' });
        await service.apply_event({
            id: 'evt_twice',
            type: 'checkout.session.completed',
            created: 1000,
            data: { object: checkout_completed(1) }
        } as any);
        expect(accounts.get(1)).toMatchObject({ plan: 'pro', stripe_subscription_id: 'sub_1' });
    });

    it('opens the portal only for an account with a Stripe customer', async () => {
        const { service, add_account, stripe } = make_service();
        add_account({ id: 1 });
        add_account({ id: 2, stripe_customer_id: 'cus_2' });
        await expect(service.create_portal_session(1)).rejects.toMatchObject({ status: 400 });
        await expect(service.create_portal_session(2)).resolves.toEqual({
            url: 'https://portal.test/p'
        });
        expect(stripe.billingPortal.sessions.create).toHaveBeenCalledWith({
            customer: 'cus_2',
            return_url: 'https://app.test/app/account'
        });
    });
});
