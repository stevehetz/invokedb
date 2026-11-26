import env from '@app/env';
import { Session } from '../session/session.entity';
import { Account } from '../account/account.entity';

// One place any backend code can hand an unhandled error to (#212), including code outside
// Nest's injection (the exception filter, process handlers in main.ts). ErrorTrackingService
// registers itself as the reporter when the app starts; before that, errors are only logged.

export type ServerSource = 'api' | 'processor';

export interface ReportContext {
    route?: string | null;
    status?: number | null;
    account_id?: number | null;
}

type Reporter = (source: ServerSource, ex: unknown, context: ReportContext) => Promise<void>;

let reporter: Reporter | null = null;

export function set_error_reporter(fn: Reporter | null) {
    reporter = fn;
}

/** Records the error; never throws. The promise ends when it's stored (or failed to be). */
export async function report_error(
    source: ServerSource,
    ex: unknown,
    context: ReportContext = {}
): Promise<void> {
    if (!reporter) return;
    try {
        await reporter(source, ex, context);
    } catch {
        // The reporter logs its own failures
    }
}

/** The caller's account id: a login Session's, or an API key's Account; null for no one. */
export function account_id_of(user: unknown): number | null {
    if (user instanceof Session) return user.account_id || null;
    if (user instanceof Account) return user.id || null;
    return null;
}

/** This process's role: the job processor alone, or the API (locally every role is one process). */
export function process_source(): ServerSource {
    return env.IS_HORIZON_PRC && !env.IS_HORIZON_BE ? 'processor' : 'api';
}
