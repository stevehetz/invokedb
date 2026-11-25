import {
    BadRequestException,
    Inject,
    Injectable,
    NotFoundException,
    ServiceUnavailableException
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import Stripe from 'stripe';
import { Account } from '@app/core/account/account.entity';
import { StripeEvent } from '@app/core/billing/stripe-event.entity';
import { get_plans, plan_for_subscription_status } from '@app/core/billing/plans';
import { TrackingManager } from '@app/core/tracking/tracking.manager';
import { STRIPE_CLIENT } from './stripe-client';
import logger from '@app/logger';
import env from '@app/env';

// What a webhook may change on the account
type PlanChange = Partial<
    Pick<Account, 'plan' | 'plan_status' | 'stripe_customer_id' | 'stripe_subscription_id'>
>;

// Subscription statuses that are live (or can become live again): a second Checkout while one
// of these exists would start a second subscription and charge the customer twice
const LIVE_SUBSCRIPTION_STATUSES = new Set([
    'active',
    'trialing',
    'past_due',
    'incomplete',
    'unpaid'
]);

function id_of(value: string | { id: string } | null | undefined): string | null {
    if (!value) return null;
    return typeof value === 'string' ? value : value.id;
}

/**
 * Billing through Stripe (#129): Stripe Checkout to upgrade, the Customer Portal to manage or
 * cancel, and the plan on the account set only from signed webhooks.
 *
 * A free account has no Stripe customer; one is created when it first starts Checkout.
 */
@Injectable()
export class BillingService {
    constructor(
        @InjectRepository(Account)
        private readonly account_repository: Repository<Account>,
        @InjectRepository(StripeEvent)
        private readonly stripe_event_repository: Repository<StripeEvent>,
        private readonly tracking_manager: TrackingManager,
        @Inject(STRIPE_CLIENT) private readonly stripe: Stripe | null
    ) {}

    // Checkout and the portal need the API key and the price; the app hides the upgrade button
    // when this is false
    is_enabled(): boolean {
        return !!(this.stripe && env.STRIPE_PRICE_ID);
    }

    private assert_enabled() {
        if (!this.is_enabled()) {
            throw new ServiceUnavailableException('Billing is not set up');
        }
    }

    private async get_account(account_id: number): Promise<Account> {
        if (!account_id) throw new NotFoundException();
        const account = await this.account_repository.findOneBy({ id: account_id });
        if (!account) throw new NotFoundException();
        return account;
    }

    private app_url(query: string) {
        return `${env.HORIZON_FE_PUB_HTTP_URL}/app/account${query}`;
    }

    // The plan, its caps, what's used and whether billing is on
    async get_status(account_id: number) {
        const account = await this.get_account(account_id);
        const usage = await this.tracking_manager.get_usage(account);
        const plans = get_plans();
        return {
            billing_enabled: this.is_enabled(),
            has_billing_account: !!account.stripe_customer_id,
            ...usage,
            plans: [plans.free, plans.pro]
        };
    }

    async create_checkout_session(account_id: number): Promise<{ url: string }> {
        this.assert_enabled();
        const account = await this.get_account(account_id);
        if (account.plan === 'internal') {
            throw new BadRequestException('This account has no paid plan');
        }
        if (account.plan === 'pro' && account.stripe_subscription_id) {
            throw new BadRequestException('Already on a paid plan: manage it in billing');
        }

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
            await this.assert_no_live_subscription(customer);
            await this.expire_open_checkouts(customer);
        }

        const session = await this.stripe.checkout.sessions.create({
            mode: 'subscription',
            customer,
            client_reference_id: String(account.id),
            line_items: [{ price: env.STRIPE_PRICE_ID, quantity: 1 }],
            subscription_data: { metadata: { account_id: String(account.id) } },
            metadata: { account_id: String(account.id) },
            success_url: this.app_url('?billing=success'),
            cancel_url: this.app_url('?billing=cancel')
        });
        return { url: session.url };
    }

    // The webhook can land after Stripe redirects back (or be retried for a while), so the
    // account may still say free while the customer already pays: ask Stripe itself
    private async assert_no_live_subscription(customer: string) {
        const subs = await this.stripe.subscriptions.list({ customer, status: 'all', limit: 10 });
        if (subs.data.some(sub => LIVE_SUBSCRIPTION_STATUSES.has(sub.status))) {
            throw new BadRequestException('Already on a paid plan: manage it in billing');
        }
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

    async create_portal_session(account_id: number): Promise<{ url: string }> {
        this.assert_enabled();
        const account = await this.get_account(account_id);
        if (!account.stripe_customer_id) {
            throw new BadRequestException('No billing account yet: upgrade first');
        }
        const session = await this.stripe.billingPortal.sessions.create({
            customer: account.stripe_customer_id,
            return_url: this.app_url('')
        });
        return { url: session.url };
    }

    /**
     * POST /webhook/stripe. Verifies the signature over the raw body, skips an event already
     * handled (by id), then applies it. If applying fails the event is forgotten again and the
     * error answers 500, so Stripe retries it.
     */
    async handle_webhook(raw_body: Buffer | undefined, signature: string | undefined) {
        const secret = env.STRIPE_WEBHOOK_SECRET;
        if (!secret) throw new ServiceUnavailableException('Billing is not set up');
        if (!raw_body || !signature) throw new BadRequestException('Missing Stripe signature');

        let event: Stripe.Event;
        try {
            event = Stripe.webhooks.constructEvent(raw_body, signature, secret);
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

    // true if this is the first time the event is seen
    private async record_event(event: Stripe.Event): Promise<boolean> {
        try {
            await this.stripe_event_repository.insert({
                id: event.id,
                type: event.type,
                created_datetime: new Date()
            });
            return true;
        } catch (ex) {
            const code = ex?.code ?? ex?.driverError?.code;
            if (code === '23505') return false; // unique_violation: seen before
            throw ex;
        }
    }

    async apply_event(event: Stripe.Event) {
        switch (event.type) {
            case 'checkout.session.completed':
                return await this.on_checkout_completed(event, event.data.object);
            case 'customer.subscription.created':
            case 'customer.subscription.updated':
            case 'customer.subscription.deleted':
                return await this.on_subscription_changed(event, event.data.object);
            case 'invoice.payment_failed':
                return await this.on_payment_failed(event, event.data.object);
            default:
                return;
        }
    }

    private async on_checkout_completed(event: Stripe.Event, session: Stripe.Checkout.Session) {
        if (session.mode !== 'subscription') return;
        if (session.payment_status === 'unpaid') return; // the subscription events follow
        const account_id = parseInt(session.client_reference_id ?? session.metadata?.account_id);
        const account = Number.isFinite(account_id)
            ? await this.account_repository.findOneBy({ id: account_id })
            : null;
        if (!account) {
            logger.warn(`Stripe ${event.id}: no account for checkout session ${session.id}`);
            return;
        }
        const subscription_id = id_of(session.subscription);
        if (
            account.plan === 'pro' &&
            account.stripe_subscription_id &&
            subscription_id &&
            account.stripe_subscription_id !== subscription_id
        ) {
            // Two Checkouts were paid (Checkout refuses a second one, so only a race gets here).
            // Track the newer subscription and flag it, so the owner can cancel and refund one.
            logger.error(
                `Stripe ${event.id}: account ${account.id} already has subscription ` +
                    `${account.stripe_subscription_id} and now also ${subscription_id}: ` +
                    `possible double charge, cancel and refund one in Stripe`
            );
        }
        await this.apply_plan(account, event, {
            plan: 'pro',
            plan_status: 'active',
            stripe_customer_id: id_of(session.customer) ?? account.stripe_customer_id,
            stripe_subscription_id: subscription_id
        });
    }

    private async on_subscription_changed(event: Stripe.Event, sub: Stripe.Subscription) {
        const account = await this.find_account(sub.metadata?.account_id, id_of(sub.customer));
        if (!account) {
            logger.warn(`Stripe ${event.id}: no account for subscription ${sub.id}`);
            return;
        }
        // An event about an older subscription (the account has since subscribed again)
        if (account.stripe_subscription_id && account.stripe_subscription_id !== sub.id) {
            logger.info(`Stripe ${event.id}: subscription ${sub.id} isn't the account's, ignored`);
            return;
        }
        const status = event.type === 'customer.subscription.deleted' ? 'canceled' : sub.status;
        // Waiting for the first payment: it becomes active or incomplete_expired next. Applying
        // it could undo a checkout.session.completed sent in the same second.
        if (status === 'incomplete') return;
        const plan = plan_for_subscription_status(status);
        await this.apply_plan(account, event, {
            plan,
            plan_status: status,
            stripe_customer_id: id_of(sub.customer) ?? account.stripe_customer_id,
            stripe_subscription_id: plan === 'pro' ? sub.id : null
        });
    }

    private async on_payment_failed(event: Stripe.Event, invoice: Stripe.Invoice) {
        const account = await this.find_account(null, id_of(invoice.customer));
        if (!account || account.plan !== 'pro') return;
        // Stripe retries the card; the plan only changes when the subscription itself does
        await this.apply_plan(account, event, { plan_status: 'past_due' });
    }

    private async find_account(account_id: string | null | undefined, customer: string | null) {
        const id = parseInt(account_id ?? '');
        if (Number.isFinite(id)) {
            const account = await this.account_repository.findOneBy({ id });
            if (account) return account;
        }
        if (!customer) return null;
        return await this.account_repository.findOneBy({ stripe_customer_id: customer });
    }

    // Applies a change unless a newer event already did; then re-checks the caps (locks the
    // account or tables read-only when over the new plan's caps, unlocks when under them)
    private async apply_plan(account: Account, event: Stripe.Event, change: PlanChange) {
        if (account.plan === 'internal') return;
        if (account.plan_event_at && Number(account.plan_event_at) > event.created) {
            logger.info(`Stripe ${event.id} is older than the last applied event, ignored`);
            return;
        }
        const update = { ...change, plan_event_at: String(event.created) };
        await this.account_repository.update({ id: account.id }, update);
        const updated = Object.assign(new Account(), account, update);
        logger.info(
            `Account ${account.id} plan: ${updated.plan} (${updated.plan_status}) from ${event.type}`
        );
        await this.tracking_manager.on_plan_change(updated);
    }
}
