import { is_expired } from '@app/core/helpers/is-expired';

/**
 * True when a login session may be used: it exists, hasn't expired, and its account exists and
 * hasn't been deleted (#282: a deleted account's other sessions stop working at once).
 */
export function session_usable(
    session: { expired_datetime: Date } | null | undefined,
    account: { deleted?: boolean } | null | undefined
) {
    return !!session && !is_expired(session.expired_datetime) && !!account && !account.deleted;
}
