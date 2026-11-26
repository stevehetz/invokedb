import {
    ExecutionContext,
    HttpException,
    HttpStatus,
    Injectable,
    NotFoundException
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Session } from '@app/core/session/session.entity';
import { AdminAccessService } from '@app/application/admin/admin-access.service';
import { RateLimiter, TOO_MANY_REQUESTS_MESSAGE } from '@app/web/http/_rate-limit/rate-limit';

const MINUTE = 60 * 1000;
// Requests per admin per minute: the pages make a few each
export const ADMIN_REQUESTS_PER_MINUTE = 120;
// Actions (plan, lock, emails, 2FA reset, delete) per admin per 10 minutes
export const ADMIN_ACTIONS_PER_10_MINUTES = 30;

/**
 * Every admin route (#277): a signed-in session (never an API key) of an admin
 * (AdminAccessService: HORIZON_ADMIN_EMAILS, a verified email and two-factor on), checked on
 * each request. Anyone else, signed in or not, gets 404, as if the routes didn't exist. Admins
 * are rate-limited per account. Puts the admin's Account on `req.admin`.
 */
@Injectable()
export class AdminGuard extends AuthGuard('bearer') {
    readonly requests = new RateLimiter(ADMIN_REQUESTS_PER_MINUTE, MINUTE);
    readonly actions = new RateLimiter(ADMIN_ACTIONS_PER_10_MINUTES, 10 * MINUTE);

    constructor(private readonly access: AdminAccessService) {
        super();
    }

    async canActivate(context: ExecutionContext): Promise<boolean> {
        try {
            if (!(await super.canActivate(context))) throw new NotFoundException();
        } catch {
            throw new NotFoundException();
        }
        const req = context.switchToHttp().getRequest();
        const user = req.user;
        if (!(user instanceof Session) || !user.account_id) throw new NotFoundException();
        const admin = await this.access.admin_account(user.account_id);
        if (!admin) throw new NotFoundException();

        const key = `admin:${admin.id}`;
        const action = req.method !== 'GET';
        if (!this.requests.hit(key) || (action && !this.actions.hit(key))) {
            throw new HttpException(TOO_MANY_REQUESTS_MESSAGE, HttpStatus.TOO_MANY_REQUESTS);
        }
        req.admin = admin;
        return true;
    }
}
