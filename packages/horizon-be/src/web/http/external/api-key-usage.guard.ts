import {
    CanActivate,
    ExecutionContext,
    HttpException,
    HttpStatus,
    Injectable
} from '@nestjs/common';
import { Account } from '@app/core/account/account.entity';
import { KeyRateLimiter } from '@app/core/api-key/key-rate-limit';
import { key_request_entry } from '@app/core/api-key/key-request-log';
import { KeyRequestLogManager } from '@app/core/api-key/key-request-log.manager';
import { account_plan } from '@app/core/plan/plans';

export const KEY_RATE_LIMIT_MESSAGE = 'Request limit exceeded for this API key';

// Runs after the bearer guard on /api/v1 (#216). For a call made with an API key it:
// - logs the call (time, method, path, status, duration) once the response is sent, whatever
//   it was, including this guard's own 429 and errors thrown later, and
// - applies the key's own rate limit, if it has one: 429 with `Retry-After` (set by
//   AllExceptionsFilter from `retry_after`). A refused call isn't counted against the account's
//   rate limit and monthly quota, which WebFileService checks later.
// Logging never fails or delays the call.
@Injectable()
export class ApiKeyUsageGuard implements CanActivate {
    private readonly limiter = new KeyRateLimiter();

    constructor(private readonly request_log: KeyRequestLogManager) {}

    canActivate(context: ExecutionContext): boolean {
        const http = context.switchToHttp();
        const req = http.getRequest();
        const res = http.getResponse();
        const user = req.user;
        const scope = user instanceof Account ? user.key_scope : undefined;
        if (!scope) return true;
        // Per-key limits and request logs are for Starter and Pro (#183); on Free a key has
        // only the account's limits, which WebFileService applies
        if (!account_plan(user).caps.key_limits_and_logs) return true;

        const started_at = Date.now();
        res.once('finish', () => {
            const entry = key_request_entry(
                req.method,
                req.originalUrl ?? req.url,
                res.statusCode,
                started_at,
                Date.now()
            );
            this.request_log.record(user.id, scope.key_id, entry).catch(err => {
                console.error('api-key: could not log the request', err);
            });
        });

        if (scope.rate_limit) {
            const taken = this.limiter.take(scope.key_id, scope.rate_limit);
            if ('retry_after_s' in taken) {
                throw new HttpException(
                    { message: KEY_RATE_LIMIT_MESSAGE, retry_after: taken.retry_after_s },
                    HttpStatus.TOO_MANY_REQUESTS
                );
            }
        }
        return true;
    }
}
