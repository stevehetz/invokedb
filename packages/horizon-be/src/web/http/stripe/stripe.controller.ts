import { Controller, Request, UseGuards, Get } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { StripeEnvService } from '@app/application/stripe.service/stripe.service';
import { AccountService } from '@app/application/account/account.service';

@Controller('stripe')
@UseGuards(AuthGuard('bearer'))
export class StripeController {
    constructor(
        private stripe_env_service: StripeEnvService,
        private account_service: AccountService
    ) {}

    async get_stripe_env(stripe_env_id) {
        return await this.stripe_env_service.get(stripe_env_id);
    }

    @Get('pk')
    async get_plan_tiers(@Request() req) {
        const account = await this.account_service.get(req.user.account_id);
        const stripe_env = await this.get_stripe_env(account.stripe_env_id);
        return stripe_env.stripe_account_public_key;
    }
}
