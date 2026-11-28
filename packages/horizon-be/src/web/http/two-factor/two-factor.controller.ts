import { Body, Controller, Get, HttpCode, Post, Request, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { TwoFactorService } from '@app/application/two-factor/two-factor.service';
import { RateLimitGuard } from '@app/web/http/_rate-limit/rate-limit';
import { session_account_id } from '@app/web/http/_auth/request-account';
import { NoDemoGuard } from '@app/web/http/_auth/demo.guard';

const HOUR = 60 * 60 * 1000;

// The signed-in account's two-factor sign-in (#214), from the Account page (session only: an API
// key can't see or change it). Code attempts (enable, disable) are limited per account in
// the service. Off in the demo (#333).
@Controller('two-factor')
@UseGuards(AuthGuard('bearer'), NoDemoGuard)
export class TwoFactorController {
    constructor(private readonly two_factor_service: TwoFactorService) {}

    /** `{ available, password_account, enabled, enabled_datetime, recovery_codes_left }` */
    @Get()
    async status(@Request() req) {
        return await this.two_factor_service.status(session_account_id(req.user));
    }

    /** A new secret to scan: `{ secret, otpauth_url, qr_code }` (an SVG data URI). */
    @Post('setup')
    @HttpCode(200)
    @UseGuards(
        new RateLimitGuard({ name: 'two-factor-setup', per_ip: 30, per_email: 0, window_ms: HOUR })
    )
    async setup(@Request() req) {
        return await this.two_factor_service.setup(session_account_id(req.user));
    }

    /** Body `{ code }` from the app. Answers `{ enabled: true, recovery_codes }`, shown once. */
    @Post('enable')
    @HttpCode(200)
    async enable(@Body() body, @Request() req) {
        return await this.two_factor_service.enable(session_account_id(req.user), body?.code);
    }

    /** Body `{ code }`: a current code or a recovery code. */
    @Post('disable')
    @HttpCode(200)
    async disable(@Body() body, @Request() req) {
        return await this.two_factor_service.disable(session_account_id(req.user), body?.code);
    }
}
