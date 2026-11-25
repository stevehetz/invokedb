// The recent requests made with each API key (#216): pure rules, unit-tested in
// key-request-log.spec.ts. KeyRequestLogManager stores them. Only the time, method, path, status
// and duration are kept: never bodies, query strings or headers.

// Requests kept per key; older ones are dropped as new ones come in
export const MAX_LOGGED_REQUESTS = 100;
export const MAX_LOGGED_PATH = 200;

export interface KeyRequest {
    // ms since the epoch
    at: number;
    method: string;
    path: string;
    status: number;
    duration_ms: number;
}

/** The entry for one request: the path without its query string, cut to MAX_LOGGED_PATH. */
export function key_request_entry(
    method: unknown,
    url: unknown,
    status: unknown,
    started_at: number,
    now: number
): KeyRequest {
    const raw = typeof url === 'string' ? url : '';
    const cut = raw.search(/[?#]/);
    const path = (cut >= 0 ? raw.slice(0, cut) : raw).slice(0, MAX_LOGGED_PATH) || '/';
    const s = Number(status);
    return {
        at: now,
        method: typeof method === 'string' ? method.toUpperCase().slice(0, 10) : '',
        path,
        status: Number.isInteger(s) ? s : 0,
        duration_ms: Math.max(0, Math.round(now - started_at))
    };
}
