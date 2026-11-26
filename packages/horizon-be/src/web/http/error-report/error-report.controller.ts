import {
    Body,
    Controller,
    ExecutionContext,
    HttpCode,
    HttpException,
    HttpStatus,
    Injectable,
    Post,
    Request,
    UseGuards
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { account_id_of } from '@app/core/error-tracking/report';
import { ErrorTrackingService } from '@app/application/error-tracking/error-tracking.service';
import { RateLimiter, TOO_MANY_REQUESTS_MESSAGE } from '@app/web/http/_rate-limit/rate-limit';

const TEN_MINUTES = 10 * 60 * 1000;
// Reports per client IP and per page session (an id the frontend makes per page load)
export const REPORTS_PER_IP = 30;
export const REPORTS_PER_SESSION = 10;

/** Signs the caller in when the token is good, and lets anyone else through as no one. */
@Injectable()
export class OptionalBearerGuard extends AuthGuard('bearer') {
    async canActivate(context: ExecutionContext): Promise<boolean> {
        try {
            await super.canActivate(context);
        } catch {
            context.switchToHttp().getRequest().user = null;
        }
        return true;
    }

    handleRequest(_err: unknown, user: any) {
        return user || null;
    }
}

// The frontend's unhandled errors (#212): window `error` and `unhandledrejection`, and Vue's
// errorHandler. Public, so the site's pages report too; signed in, the account id is kept.
@Controller('errors')
export class ErrorReportController {
    readonly by_ip = new RateLimiter(REPORTS_PER_IP, TEN_MINUTES);
    readonly by_session = new RateLimiter(REPORTS_PER_SESSION, TEN_MINUTES);

    constructor(private readonly error_tracking: ErrorTrackingService) {}

    /** `{ message, stack?, page?, kind?: 'error' | 'unhandledrejection' | 'vue', info?, session? }` */
    @Post()
    @HttpCode(202)
    @UseGuards(OptionalBearerGuard)
    async report(@Body() body, @Request() req) {
        const session =
            body && typeof body.session === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(body.session)
                ? body.session
                : null;
        const ip_ok = this.by_ip.hit(`ip:${req.ip ?? 'unknown'}`);
        const session_ok = session ? this.by_session.hit(`session:${session}`) : true;
        if (!ip_ok || !session_ok) {
            throw new HttpException(TOO_MANY_REQUESTS_MESSAGE, HttpStatus.TOO_MANY_REQUESTS);
        }
        return await this.error_tracking.record_client(
            body,
            req.headers?.['user-agent'],
            account_id_of(req.user)
        );
    }
}
