import { UnauthorizedException } from '@nestjs/common';
import { Session } from '@app/core/session/session.entity';
import { Account } from '@app/core/account/account.entity';

/**
 * The account id of the signed-in caller, for the app's internal routes.
 *
 * The bearer strategy (`application/auth/http.strategy.ts`) sets `req.user` to a `Session` for an
 * `internal_…` login token, or to an `Account` for an API key. Internal routes only accept a login
 * session: an API key is for `/api/v1` and must not manage tables or the account. Never take the
 * account id from the query string or body.
 */
export function session_account_id(user: any): number {
    if (user instanceof Session && user.account_id) {
        return user.account_id;
    }
    throw new UnauthorizedException();
}

/**
 * The account of an `/api/v1` caller, which must use the account's API key (`req.user` is then
 * the `Account`). A login session token is for the app's own routes.
 */
export function api_key_account(user: any): Account {
    if (user instanceof Account && user.id) {
        return user;
    }
    throw new UnauthorizedException();
}
