import { is_expired } from '@app/core/helpers/is-expired';

/**
 * True when a login session may be used: it exists, hasn't expired, and its account exists and
 * hasn't been deleted (#282: a deleted account's other sessions stop working at once). A demo
 * account's sessions (#333) stop when the demo expires, before the hourly sweep deletes it.
 */
export function session_usable(
    session: { expired_datetime: Date } | null | undefined,
    account: { deleted?: boolean; demo_expires_at?: Date | null } | null | undefined,
    now: number = Date.now()
) {
    if (!session || is_expired(session.expired_datetime) || !account || account.deleted) {
        return false;
    }
    const demo_end = account.demo_expires_at ? new Date(account.demo_expires_at).getTime() : null;
    return demo_end === null || !(demo_end <= now);
}
