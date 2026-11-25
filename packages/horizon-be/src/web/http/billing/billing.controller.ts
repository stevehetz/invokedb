import { Controller, Get, Headers, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { BillingService } from '@app/application/billing/billing.service';
import { session_account_id } from '@app/web/http/_auth/request-account';

// The signed-in account's plan and usage, and the Stripe Checkout / Customer Portal links
@Controller('billing')
@UseGuards(AuthGuard('bearer'))
export class BillingController {
    constructor(private readonly billing_service: BillingService) {}

    @Get()
    async status(@Req() req) {
        return await this.billing_service.get_status(session_account_id(req.user));
    }

    @Post('checkout')
    @HttpCode(200)
    async checkout(@Req() req) {
        return await this.billing_service.create_checkout_session(session_account_id(req.user));
    }

    @Post('portal')
    @HttpCode(200)
    async portal(@Req() req) {
        return await this.billing_service.create_portal_session(session_account_id(req.user));
    }
}

// Stripe's webhook endpoint (no login: the signature over the raw body is the auth)
@Controller('webhook')
export class StripeWebhookController {
    constructor(private readonly billing_service: BillingService) {}

    @Post('stripe')
    @HttpCode(200)
    async stripe(
        @Req() req: RawBodyRequest<Request>,
        @Headers('stripe-signature') signature: string
    ) {
        return await this.billing_service.handle_webhook(req.rawBody, signature);
    }
}
