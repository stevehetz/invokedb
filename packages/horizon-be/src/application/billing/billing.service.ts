import {
    BadRequestException,
    ConflictException,
    Inject,
    Injectable,
    NotFoundException,
    OnModuleInit,
    ServiceUnavailableException
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import Stripe from 'stripe';
import { Account } from '@app/core/account/account.entity';
import { StripeEvent } from '@app/core/billing/stripe-event.entity';
import {
    BillingState,
    LIVE_STATUSES,
    PRICE_LOOKUP_KEYS,
    billing_state,
    checkout_account_id,
    event_customer,
    parse_checkout_request
} from '@app/core/billing/billing';
import { PLAN_SUBSCRIPTIONS, account_plan, plan_id_of } from '@app/core/plan/plans';
import { parse_plan_state } from '@app/core/plan/plan-state';
import { PlanStateService } from '../plan/plan-state.service';
import { AccountService } from '../account/account.service';
import { STRIPE_CLIENT } from './stripe-client';
import env from '@app/env';
import logger from '@app/logger';

// How long a price id found by its lookup key is kept
const PRICE_CACHE_MS = 10 * 60 * 1000;

/**
 * Billing through Stripe (#129, docs/PRICING.md 3.4): Stripe Checkout to buy a plan, the
 * Customer Portal to change, cancel or update the card, and the plan on the account set only
 * from signed webhooks, never from the browser.
 *
 * Every webhook event about a customer makes the account's plan be read again from the
 * customer's subscriptions as Stripe holds them now (`sync`), so events that arrive late, twice
 * or at once can't leave the wrong plan. A free account has no Stripe customer; one is made at
 * its first Checkout.
 */
@Injectable()
export class BillingService implements OnModuleInit {
    // One sync per account at a time
    private syncing = new Map<number, Promise<unknown>>();
    private prices = new Map<string, { id: string; at: number }>();

    constructor(
        @InjectRepository(Account)
        private readonly account_repository: Repository<Account>,
        @InjectRepository(StripeEvent)
        private readonly stripe_event_repository: Repository<StripeEvent>,
        private readonly plan_state_service: PlanStateService,
        private readonly account_service: AccountService,
        @Inject(STRIPE_CLIENT) private readonly stripe: Stripe | null
    ) {}

    // The clock, replaceable in tests
    now: () => number = () => Date.now();

    onModuleInit() {
        // When a grace period ends the account goes to Free (PlanStateService): stop Stripe
        // retrying the card of a plan it no longer has
        this.plan_state_service.set_grace_ended_listener(id => this.cancel_subscriptions(id));
        // A deleted account can't sign in to the Portal: cancel its subscription first, and
        // refuse the deletion when that can't be done
        this.account_service.set_before_delete(id => this.cancel_subscriptions(id));
    }

    /** Checkout and the webhook need the API key and the signing secret. */
    enabled(): boolean {
        return !!(this.stripe && env.STRIPE_WEBHOOK_SECRET);
    }

    private assert_enabled() {
        if (!this.enabled()) throw new ServiceUnavailableException('Billing is not set up');
    }

    private async get_account(account_id: number): Promise<Account> {
        if (!account_id) throw new NotFoundException();
        const account = await this.account_repository.findOneBy({ id: account_id });
        if (!account || account.deleted) throw new NotFoundException();
        return account;
    }

    private app_url(query: string) {
        const base = String(env.HORIZON_FE_PUB_HTTP_URL || '').replace(/\/$/, '');
        return `${base}/app/account${query}`;
    }

    private async subscriptions(customer: string): Promise<Stripe.Subscription[]> {
        const list = await this.stripe.subscriptions.list({ customer, status: 'all', limit: 20 });
        return list.data;
    }

    /**
     * `GET /billing`: whether billing is on, and the account's subscription as Stripe has it
     * (none for an account that never bought a plan).
     */
    async status(account_id: number) {
        const account = await this.get_account(account_id);
        const plan = account_plan(account);
        let subscription: Omit<BillingState, 'pending' | 'subscription_id'> | null = null;
        if (this.enabled() && account.stripe_customer_id) {
            try {
                const state = billing_state(await this.subscriptions(account.stripe_customer_id));
                if (state.status) {
                    subscription = {
                        plan: state.plan,
                        interval: state.interval,
                        status: state.status,
                        failing: state.failing,
                        cancel_at_period_end: state.cancel_at_period_end,
                        current_period_end: state.current_period_end
                    };
                }
            } catch (ex) {
                logger.warn(`Billing status of account ${account.id}: ${ex && ex.message}`);
            }
        }
        return {
            enabled: this.enabled(),
            plan: plan.plan.id,
            // An internal account (no caps) has nothing to buy
            can_buy: this.enabled() && !plan.internal,
            has_billing_account: !!account.stripe_customer_id,
            subscription
        };
    }

    /**
     * `POST /billing/checkout` `{ plan: 'STARTER' | 'PRO', interval: 'month' | 'year' }`: a
     * Stripe Checkout page for a new subscription. Refused while the customer has one that can
     * still charge (a plan change goes through the Portal), so nobody pays twice.
     */
    async checkout(account_id: number, body: any): Promise<{ url: string }> {
        this.assert_enabled();
        const req = parse_checkout_request(body);
        if (!req)
            throw new BadRequestException('plan must be STARTER or PRO, interval month or year');
        return await this.one_at_a_time(account_id, async () => {
            const account = await this.get_account(account_id);
            if (account_plan(account).internal) {
                throw new BadRequestException('This account has no caps, so no plan to buy');
            }
            const price = await this.price_id(PRICE_LOOKUP_KEYS[req.plan][req.interval]);

            let customer = account.stripe_customer_id;
            if (!customer) {
                const created = await this.stripe.customers.create({
                    email: account.email,
                    metadata: { account_id: String(account.id) }
                });
                customer = created.id;
                await this.account_repository.update(
                    { id: account.id },
                    { stripe_customer_id: customer }
                );
            } else {
                // The webhook can come after Stripe sends the customer back, so ask Stripe
                const subs = await this.subscriptions(customer);
                if (subs.some(s => LIVE_STATUSES.has(s.status))) {
                    throw new ConflictException(
                        'You already have a plan: change or cancel it in Manage billing'
                    );
                }
                await this.expire_open_checkouts(customer);
            }

            const session = await this.stripe.checkout.sessions.create({
                mode: 'subscription',
                customer,
                client_reference_id: String(account.id),
                line_items: [{ price, quantity: 1 }],
                allow_promotion_codes: true,
                subscription_data: { metadata: { account_id: String(account.id) } },
                metadata: { account_id: String(account.id) },
                success_url: this.app_url('?billing=success'),
                cancel_url: this.app_url('?billing=cancel')
            });
            if (!session.url) throw new ServiceUnavailableException('Stripe gave no Checkout page');
            return { url: session.url };
        });
    }

    // The id of the active price with this lookup key (cached for a while)
    private async price_id(lookup_key: string): Promise<string> {
        const cached = this.prices.get(lookup_key);
        if (cached && this.now() - cached.at < PRICE_CACHE_MS) return cached.id;
        const list = await this.stripe.prices.list({
            lookup_keys: [lookup_key],
            active: true,
            limit: 1
        });
        const price = list.data[0];
        if (!price) {
            logger.error(`Stripe has no active price with the lookup key ${lookup_key}`);
            throw new ServiceUnavailableException('This plan is not on sale yet');
        }
        this.prices.set(lookup_key, { id: price.id, at: this.now() });
        return price.id;
    }

    // A Checkout left open in another tab could still be paid after this one: expire it
    private async expire_open_checkouts(customer: string) {
        const open = await this.stripe.checkout.sessions.list({
            customer,
            status: 'open',
            limit: 10
        });
        for (const session of open.data) {
            await this.stripe.checkout.sessions.expire(session.id);
        }
    }

    /** `POST /billing/portal`: the Customer Portal, to change plan, cancel or update the card. */
    async portal(account_id: number): Promise<{ url: string }> {
        this.assert_enabled();
        const account = await this.get_account(account_id);
        if (!account.stripe_customer_id) {
            throw new BadRequestException('No billing account yet: choose a plan first');
        }
        const session = await this.stripe.billingPortal.sessions.create({
            customer: account.stripe_customer_id,
            return_url: this.app_url('?billing=portal')
        });
        return { url: session.url };
    }

    /**
     * `POST /billing/webhook`. Checks the signature over the raw body, skips an event already
     * handled (by id), then reads the customer's plan again. If that fails the event is
     * forgotten and the error answers 500, so Stripe sends it again.
     */
    async handle_webhook(raw_body: Buffer | undefined, signature: string | undefined) {
        const secret = env.STRIPE_WEBHOOK_SECRET;
        if (!secret || !this.stripe) throw new ServiceUnavailableException('Billing is not set up');
        if (!raw_body || !signature) throw new BadRequestException('Missing Stripe signature');

        let event: Stripe.Event;
        try {
            event = this.stripe.webhooks.constructEvent(raw_body, signature, secret);
        } catch {
            throw new BadRequestException('Invalid Stripe signature');
        }

        if (!(await this.record_event(event))) {
            logger.info(`Stripe event ${event.id} (${event.type}) already handled`);
            return { received: true, duplicate: true };
        }
        try {
            await this.apply_event(event);
        } catch (ex) {
            await this.stripe_event_repository.delete({ id: event.id });
            throw ex;
        }
        return { received: true };
    }

    // true the first time an event is seen
    private async record_event(event: Stripe.Event): Promise<boolean> {
        try {
            await this.stripe_event_repository.insert({ id: event.id, type: event.type });
            return true;
        } catch (ex) {
            const code = ex?.code ?? ex?.driverError?.code;
            if (code === '23505') return false; // unique_violation: seen before
            throw ex;
        }
    }

    async apply_event(event: Stripe.Event) {
        const customer = event_customer(event);
        if (!customer) return;
        const account = await this.account_of_customer(customer, event);
        if (!account) {
            logger.warn(`Stripe ${event.id} (${event.type}): no account for customer ${customer}`);
            return;
        }
        await this.sync(account.id);
    }

    // The account a Stripe customer belongs to: by the id we stored, or (a customer made
    // before the id was saved) by the account id Checkout or the customer carries
    private async account_of_customer(customer: string, event: Stripe.Event) {
        const found = await this.account_repository.findOneBy({ stripe_customer_id: customer });
        if (found) return found.deleted ? null : found;
        let id: number | null = null;
        if (event.type === 'checkout.session.completed') {
            id = checkout_account_id(event.data.object);
        } else {
            const c = await this.stripe.customers.retrieve(customer);
            if (!('deleted' in c && c.deleted)) {
                id = checkout_account_id({ metadata: (c as Stripe.Customer).metadata });
            }
        }
        if (!id) return null;
        const account = await this.account_repository.findOneBy({
            id,
            stripe_customer_id: IsNull()
        });
        if (!account || account.deleted) return null;
        await this.account_repository.update({ id }, { stripe_customer_id: customer });
        return { ...account, stripe_customer_id: customer } as Account;
    }

    /**
     * Sets account `account_id`'s plan from its customer's subscriptions as Stripe holds them
     * now, then works out its plan state (read-only when over the new plan's caps, lifted when
     * under them). A failing payment keeps the plan in a 14-day grace period. With no paying
     * subscription left, an account whose plan came from Stripe goes to Free; a plan an admin
     * set (no Stripe subscription) is left alone.
     */
    async sync(account_id: number) {
        return await this.one_at_a_time(account_id, async () => {
            const account = await this.get_account(account_id);
            if (!account.stripe_customer_id) return;
            const state = billing_state(await this.subscriptions(account.stripe_customer_id));
            if (state.pending) return;
            const before = plan_id_of(account.subscription_id);
            const plan_state = parse_plan_state(account.plan_state);

            if (state.plan !== 'FREE') {
                const update: Partial<Account> = {
                    subscription_id: PLAN_SUBSCRIPTIONS[state.plan],
                    stripe_subscription_id: state.subscription_id
                };
                // Paid again: the grace period is over
                if (!state.failing && plan_state === 'grace') {
                    Object.assign(update, { plan_state: 'active', grace_ends_at: null });
                }
                await this.account_repository.update({ id: account.id }, update);
                if (state.failing && plan_state !== 'grace') {
                    await this.plan_state_service.start_grace(account.id);
                }
            } else if (account.stripe_subscription_id) {
                // The Stripe plan ended (cancelled at the period's end, or the retries failed)
                await this.account_repository.update(
                    { id: account.id },
                    {
                        subscription_id: PLAN_SUBSCRIPTIONS.FREE,
                        stripe_subscription_id: null,
                        plan_state: plan_state === 'grace' ? 'active' : plan_state,
                        grace_ends_at: null,
                        // A lapse starts the free account's idle clock (docs/PRICING.md 3.4)
                        idle_clock_at: new Date(this.now())
                    }
                );
            } else {
                return;
            }
            const { state: next } = await this.plan_state_service.refresh(account.id);
            const after = state.plan;
            if (before !== after || state.failing) {
                logger.info(
                    `Account ${account.id}: plan ${before} -> ${after}` +
                        `${state.status ? ` (${state.status})` : ''}, state ${next}`
                );
            }
        });
    }

    /**
     * Cancels every subscription of the account's customer that can still charge it, at once,
     * and expires any open Checkout: before the account is deleted (it can't sign in to the
     * Portal any more), and when its grace period ends. Throws when Stripe can't be reached, so
     * a deletion is refused instead of leaving a subscription charging.
     */
    async cancel_subscriptions(account_id: number) {
        const account = await this.account_repository.findOneBy({ id: account_id });
        if (!account || !account.stripe_customer_id) return;
        if (!this.stripe) {
            if (!account.stripe_subscription_id) return;
            throw new ServiceUnavailableException(
                'Billing is unavailable, so the paid plan cannot be cancelled: try again later'
            );
        }
        const customer = account.stripe_customer_id;
        await this.expire_open_checkouts(customer);
        for (const sub of await this.subscriptions(customer)) {
            if (!LIVE_STATUSES.has(sub.status)) continue;
            await this.stripe.subscriptions.cancel(sub.id);
            logger.info(`Account ${account.id}: cancelled Stripe subscription ${sub.id}`);
        }
    }

    // Runs `fn` after any other billing work on the same account (Checkout or a sync)
    private async one_at_a_time<T>(account_id: number, fn: () => Promise<T>): Promise<T> {
        const previous = this.syncing.get(account_id) || Promise.resolve();
        const run = previous.catch(() => undefined).then(fn);
        this.syncing.set(account_id, run);
        try {
            return await run;
        } finally {
            if (this.syncing.get(account_id) === run) this.syncing.delete(account_id);
        }
    }
}
