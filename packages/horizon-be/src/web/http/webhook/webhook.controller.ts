import { Controller, Post, Request, HttpStatus, Response } from '@nestjs/common';
import { AccountService } from '@app/application/account/account.service';
import { AccountUpdateDto } from '@app/application/account/dto/account-update.dto';
import { SubscriptionService } from '@app/application/subscription/subscription.service';
import logger from '@app/logger';

@Controller('webhook')
export class WebhookController {
    constructor(
        private subscription_service: SubscriptionService,
        private account_service: AccountService
    ) {}

    @Post('stripe')
    async stripe_webhook(@Request() req, @Response() res) {
        const event = req.body;
        if (event.type.indexOf('customer.subscription') > -1) {
            logger.debug('\n\n\nWebhook invoked: ' + event.type);
            const index = event.type.lastIndexOf('.') + 1;
            const type = event.type.substring(index);
            const { previous_attributes } = event.data;
            const { plan, status } = event.data.object;
            const stripe_customer_id = event.data.object.customer;

            const subscription = await this.subscription_service.get_by_plan_id(plan.id);
            let account = await this.account_service.get_by_stripe_customer_id(stripe_customer_id);

            if (!account) {
                return res.status(HttpStatus.BAD_REQUEST).send('Account not found');
            }

            logger.debug(`Webhook: Subscription status - ${status}`);

            if (status === 'canceled') {
                const update_dto = new AccountUpdateDto();
                update_dto.subscription_id = null;
                await this.account_service.update(account.id, update_dto);
                account = await this.account_service.get(account.id);
                logger.debug(`Webhook: Subscription canceled: ${event.data.object.id}`);
                await this.subscription_service.on_subscription_change(account);
            } else if (
                status === 'active' &&
                (type === 'created' || (type === 'updated' && previous_attributes.plan))
            ) {
                const update_dto = new AccountUpdateDto();
                update_dto.subscription_id = subscription.id;
                await this.account_service.update(account.id, update_dto);
                account = await this.account_service.get(account.id);
                logger.debug(`Webhook: Plan updated to ${plan.id}`);
                await this.subscription_service.on_subscription_change(account);
            }
        }
        return res.status(HttpStatus.OK).send('success');
    }
}
