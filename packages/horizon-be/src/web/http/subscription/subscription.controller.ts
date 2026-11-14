import {
    Controller,
    Post,
    Request,
    HttpException,
    HttpStatus,
    UseGuards,
    Get
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AccountService } from '@app/application/account/account.service';
import { AccountUpdateDto } from '@app/application/account/dto/account-update.dto';
import { SubscriptionService } from '@app/application/subscription/subscription.service';
import { StripeEnvService } from '@app/application/stripe.service/stripe.service';
import logger from '@app/logger';

@Controller('subscription')
@UseGuards(AuthGuard('bearer'))
export class SubscriptionController {
    constructor(
        private subscription_service: SubscriptionService,
        private account_service: AccountService,
        private stripe_env_service: StripeEnvService
    ) {}

    async get_stripe_env(stripe_env_id) {
        return await this.stripe_env_service.get(stripe_env_id);
    }

    @Get('plan-tiers')
    async get_plan_tiers(@Request() req) {
        const account = await this.account_service.get(req.user.account_id);
        return await this.subscription_service.get_all(account.stripe_env_id);
    }

    @Get('stripe-subscription')
    async get_stripe_subscription(@Request() req) {
        const account = await this.account_service.get(req.user.account_id);
        if (account.stripe_subscription_id) {
            const stripe_env = await this.get_stripe_env(account.stripe_env_id);
            const stripe = require('stripe')(stripe_env.stripe_account_secret_key);
            return await stripe.subscriptions.retrieve(account.stripe_subscription_id);
        }
        return null;
    }

    @Get('stripe-pk')
    async get_stripe_pk(@Request() req) {
        const account = await this.account_service.get(req.user.account_id);
        const stripe_env = await this.get_stripe_env(account.stripe_env_id);
        return stripe_env.stripe_account_public_key;
    }

    @Post('billing-portal')
    async get_billing_portal(@Request() req) {
        const account = await this.account_service.get(req.user.account_id);
        const stripe_env = await this.get_stripe_env(account.stripe_env_id);
        const stripe = require('stripe')(stripe_env.stripe_account_secret_key);
        return await stripe.billingPortal.sessions.create({
            customer: account.stripe_customer_id,
            return_url: req.body.return_url
        });
    }

    @Post('create')
    async create(@Request() req) {
        const account = await this.account_service.get(req.user.account_id);

        const stripe_env = await this.get_stripe_env(account.stripe_env_id);

        const stripe = require('stripe')(stripe_env.stripe_account_secret_key);

        const { payment_method, email, subscription_id } = req.body;

        const selected_subscription = await this.subscription_service.get(subscription_id);

        if (!selected_subscription) {
            throw new HttpException('Subscription not found', HttpStatus.INTERNAL_SERVER_ERROR);
        }

        let customer;

        try {
            if (account.stripe_customer_id) {
                await stripe.paymentMethods.attach(payment_method, {
                    customer: account.stripe_customer_id
                });
                customer = await stripe.customers.update(account.stripe_customer_id, {
                    invoice_settings: {
                        default_payment_method: payment_method
                    }
                });
                logger.debug('Customer found');
            } else {
                customer = await stripe.customers.create({
                    payment_method,
                    email,
                    invoice_settings: {
                        default_payment_method: req.body.payment_method
                    }
                });
                const update_dto = new AccountUpdateDto();
                update_dto.stripe_customer_id = customer.id;

                await this.account_service.update(req.user.account_id, update_dto);
                logger.debug('Success creating customer');
            }
        } catch (ex) {
            logger.debug('Error creating customer');
            throw new HttpException(ex, HttpStatus.BAD_REQUEST);
        }

        let subscription;
        if (account.stripe_subscription_id) {
            logger.debug('Found subscription');
            subscription = await stripe.subscriptions.retrieve(account.stripe_subscription_id);
            logger.debug(subscription.status);
            if (subscription.status === 'active') {
                throw new HttpException(
                    'There is already an active subscription tied to this account',
                    HttpStatus.BAD_REQUEST
                );
            } else if (subscription.status === 'incomplete') {
                const invoice = await stripe.invoices.retrieve(subscription.latest_invoice, {
                    expand: ['payment_intent']
                });

                logger.debug(invoice.payment_intent.status);
                if (invoice.payment_intent.status === 'requires_action') {
                    subscription = await stripe.subscriptions.retrieve(
                        account.stripe_subscription_id,
                        {
                            expand: ['latest_invoice.payment_intent']
                        }
                    );
                }

                if (invoice.payment_intent.status === 'requires_payment_method') {
                    try {
                        await stripe.invoices.pay(subscription.latest_invoice, {
                            expand: ['payment_intent']
                        });
                    } catch (ex) {
                        if (
                            !ex.message ||
                            ex.message.indexOf('This payment requires additional user action') ===
                                -1
                        ) {
                            throw ex;
                        }
                    }
                    subscription = await stripe.subscriptions.retrieve(
                        account.stripe_subscription_id,
                        {
                            expand: ['latest_invoice.payment_intent']
                        }
                    );
                }
            } else {
                subscription = await this.create_subscription(
                    req.user.account_id,
                    customer,
                    selected_subscription,
                    stripe_env
                );
            }
        } else {
            subscription = await this.create_subscription(
                req.user.account_id,
                customer,
                selected_subscription,
                stripe_env
            );
        }

        return subscription;
    }

    async create_subscription(account_id, customer, selected_subscription, stripe_env) {
        const stripe = require('stripe')(stripe_env.stripe_account_secret_key);

        let subscription;
        try {
            subscription = await stripe.subscriptions.create({
                customer: customer.id,
                items: [{ price: selected_subscription.stripe_plan_id }],
                expand: ['latest_invoice.payment_intent']
            });

            const update_dto = new AccountUpdateDto();
            update_dto.stripe_subscription_id = subscription.id;
            update_dto.subscription_id = selected_subscription.id;

            await this.account_service.update(account_id, update_dto);
            const updated_account = await this.account_service.get(account_id);
            await this.subscription_service.on_subscription_change(updated_account);

            logger.debug('Success creating subscription');
        } catch (ex) {
            logger.debug('Error creating subscription');
            logger.debug(ex);
        }

        return subscription;
    }
}
