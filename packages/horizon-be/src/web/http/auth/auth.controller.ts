import {
    Controller,
    Get,
    HttpException,
    HttpStatus,
    Post,
    Request,
    UseGuards
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AuthService } from '@app/application/auth/auth.service';
import {
    RateLimitGuard,
    RateLimiter,
    TOO_MANY_REQUESTS_MESSAGE
} from '@app/web/http/_rate-limit/rate-limit';
import { session_account_id } from '@app/web/http/_auth/request-account';
import { DemoService } from '@app/application/demo/demo.service';

const HOUR = 60 * 60 * 1000;

@Controller('auth')
export class AuthController {
    // Resending sends an email, so it's limited per account as well as per IP (#132, #133)
    private readonly resend_per_account = new RateLimiter(3, HOUR);

    constructor(
        private readonly auth_service: AuthService,
        private readonly demo_service: DemoService
    ) {}

    // The home page's "Try the demo" (#333): a fresh demo account, filled, and its session.
    // DemoService counts the accounts made per IP (3 a day) and live (50); the guard only keeps
    // a script from hammering the route.
    @Post('demo')
    @UseGuards(new RateLimitGuard({ name: 'demo', per_ip: 20, per_email: 0, window_ms: HOUR }))
    async demo(@Request() req) {
        return await this.demo_service.create(req.ip);
    }

    @Post('login')
    async login(@Request() req) {
        return await this.auth_service.login(req.body);
    }

    // The code step when two-factor sign-in is on (#214). Limited per IP here, and per account
    // and per challenge in TwoFactorService, like the password routes (#133).
    @Post('login/two-factor')
    @UseGuards(
        new RateLimitGuard({ name: 'login-two-factor', per_ip: 30, per_email: 0, window_ms: HOUR })
    )
    async login_two_factor(@Request() req) {
        return await this.auth_service.login_two_factor(req.body);
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

    // The link in the verification email (the site's /verify-email page calls it)
    @Get('verify-email')
    async verify_email(@Request() req) {
        return await this.auth_service.verify_email(req.query.token);
    }

    // The app's banner: send a new verification link to the signed-in account
    @Post('resend-verification')
    @UseGuards(
        AuthGuard('bearer'),
        new RateLimitGuard({
            name: 'resend-verification',
            per_ip: 10,
            per_email: 3,
            window_ms: HOUR
        })
    )
    async resend_verification(@Request() req) {
        const account_id = session_account_id(req.user);
        if (!this.resend_per_account.hit(`account:${account_id}`)) {
            throw new HttpException(TOO_MANY_REQUESTS_MESSAGE, HttpStatus.TOO_MANY_REQUESTS);
        }
        return await this.auth_service.resend_verification(account_id);
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
