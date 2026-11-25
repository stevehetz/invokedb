import { Controller, Get, Post, Request, UseGuards } from '@nestjs/common';
import { AuthService } from '@app/application/auth/auth.service';
import { RateLimitGuard } from '@app/web/http/_rate-limit/rate-limit';

const HOUR = 60 * 60 * 1000;

@Controller('auth')
export class AuthController {
    constructor(private readonly auth_service: AuthService) {}

    @Post('login')
    async login(@Request() req) {
        return await this.auth_service.login(req.body);
    }

    @Get('logout')
    async logout(@Request() req) {
        return await this.auth_service.logout(req.query.token);
    }

    @Get('authorize')
    async authorize(@Request() req) {
        return await this.auth_service.authorize(req.query.token);
    }

    // Both send an email, so they're rate-limited by IP and by email (#133)
    @Post('create-account')
    @UseGuards(
        new RateLimitGuard({ name: 'create-account', per_ip: 10, per_email: 3, window_ms: HOUR })
    )
    async create_account(@Request() req) {
        return await this.auth_service.create_account(req.body);
    }

    @Get('reset-password')
    @UseGuards(
        new RateLimitGuard({ name: 'reset-password', per_ip: 10, per_email: 3, window_ms: HOUR })
    )
    async reset_password(@Request() req) {
        return await this.auth_service.reset_password(req.query.email);
    }

    @Get('confirm-reset-token')
    async confirm_reset_token(@Request() req) {
        return await this.auth_service.confirm_reset_token(req.query.token);
    }

    @Post('change-password')
    async change_password(@Request() req) {
        return await this.auth_service.change_password(req.body);
    }
}
