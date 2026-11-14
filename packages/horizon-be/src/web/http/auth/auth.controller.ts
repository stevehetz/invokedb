import { Controller, Get, Post, Request } from '@nestjs/common';
import { AuthService } from '@app/application/auth/auth.service';

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

    @Post('create-account')
    async create_account(@Request() req) {
        return await this.auth_service.create_account(req.body);
    }

    @Get('reset-password')
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
