import { Controller, Request, UseGuards, Get } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AccountService } from '@app/application/account/account.service';
import { SubscriptionService } from '@app/application/subscription/subscription.service';
import { session_account_id } from '@app/web/http/_auth/request-account';

@Controller('subscription')
@UseGuards(AuthGuard('bearer'))
export class SubscriptionController {
    constructor(
        private subscription_service: SubscriptionService,
        private account_service: AccountService
    ) {}

    @Get('plan-tiers')
    async get_plan_tiers(@Request() req) {
        const account = await this.account_service.get(session_account_id(req.user));
        return await this.subscription_service.get_all(account.stripe_env_id);
    }
}
