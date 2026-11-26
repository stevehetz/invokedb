import { Body, Controller, Get, Headers, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { BillingService } from '@app/application/billing/billing.service';
import { session_account_id } from '@app/web/http/_auth/request-account';

// The signed-in account's subscription, and the Stripe Checkout and Customer Portal links
// (#129). Session only: an API key can't buy or change a plan.
@Controller('billing')
@UseGuards(AuthGuard('bearer'))
export class BillingController {
    constructor(private readonly billing_service: BillingService) {}

    @Get()
    async status(@Req() req) {
        return await this.billing_service.status(session_account_id(req.user));
    }

    // Body: `{ plan: 'STARTER' | 'PRO', interval: 'month' | 'year' }`
    @Post('checkout')
    @HttpCode(200)
    async checkout(@Body() body, @Req() req) {
        return await this.billing_service.checkout(session_account_id(req.user), body);
    }

    @Post('portal')
    @HttpCode(200)
    async portal(@Req() req) {
        return await this.billing_service.portal(session_account_id(req.user));
    }
}

// Stripe's webhook endpoint. No login: the signature over the raw body is the check.
@Controller('billing/webhook')
export class StripeWebhookController {
    constructor(private readonly billing_service: BillingService) {}

    @Post()
    @HttpCode(200)
    async stripe(
        @Req() req: RawBodyRequest<Request>,
        @Headers('stripe-signature') signature: string
    ) {
        return await this.billing_service.handle_webhook(req.rawBody, signature);
    }
}
