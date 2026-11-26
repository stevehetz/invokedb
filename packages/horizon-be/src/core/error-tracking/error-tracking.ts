import { createHash } from 'crypto';

// Error tracking (#212), self-hosted: the backend's unhandled errors (API and processor) and
// the ones the frontend posts are kept in the tracking DB, grouped by a fingerprint (the
// message without its numbers and ids, plus the top stack frame), with a count and the first
// and last time seen. Never a request body, a header or a secret: messages and stacks are
// scrubbed and cut short before they're stored. These are the pure rules.

export type ErrorSource = 'api' | 'processor' | 'frontend';
export const ERROR_SOURCES: ErrorSource[] = ['api', 'processor', 'frontend'];

// Errors not seen again for this long are dropped (a TTL index on last_seen)
export const KEEP_DAYS = 30;
// At most one Telegram message per fingerprint per this long
export const ALERT_EVERY_MS = 60 * 60 * 1000;
// And at most this many alerts an hour in all, per process, so a flood can't spam the chat
export const ALERTS_PER_HOUR = 10;
// New fingerprints stop being stored past this many (existing ones still count). The public
// POST /errors can be posted by anyone, so frontend reports have their own cap: they can only
// crowd out other frontend reports, never the backend's (api and processor share theirs).
export const MAX_FINGERPRINTS = { backend: 3000, frontend: 2000 };
export type CapGroup = keyof typeof MAX_FINGERPRINTS;

/** Which fingerprint cap a source counts against. */
export const cap_group = (source: ErrorSource): CapGroup =>
    source === 'frontend' ? 'frontend' : 'backend';

/** The sources sharing a cap group (for counting its fingerprints). */
export const cap_group_sources = (group: CapGroup): ErrorSource[] =>
    ERROR_SOURCES.filter(s => cap_group(s) === group);

export const MAX_MESSAGE = 500;
export const MAX_STACK = 8000;
export const MAX_STACK_LINES = 40;
const MAX_FIELD = 300;

/** What a recorded error carries, already scrubbed. */
export interface ErrorEvent {
    source: ErrorSource;
    message: string;
    stack: string | null;
    top_frame: string | null;
    // API: "GET /web-file/:id"; processor: what was running ("job FILE_UPLOAD")
    route: string | null;
    status: number | null;
    account_id: number | null;
    // Frontend only: the page's path (no query string), the browser and how it was caught
    page: string | null;
    user_agent: string | null;
    kind: string | null;
}

export class ErrorReportError extends Error {}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/**
 * Takes out what could be personal or secret: email addresses, bearer tokens, credentials in
 * URLs, query strings, `key=value` secrets and long token-like strings.
 */
export function scrub(text: string): string {
    return (
        text
            // user:password@ in a URL
            .replace(/(\b[a-z][a-z0-9+.-]*:\/\/)[^/\s:@]+:[^/\s@]+@/gi, '$1<credentials>@')
            // A URL's query string
            .replace(/(\b(?:https?|wss?):\/\/[^\s?#'"]*)\?[^\s#'")]*/gi, '$1?<query>')
            .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '<email>')
            .replace(/\b(bearer|basic)\s+[^\s,;'"]+/gi, '$1 <token>')
            .replace(
                /\b(password|passwd|secret|token|api[_-]?key|authorization|cookie)(["']?\s*[:=]\s*["']?)[^\s,;&'"}]+/gi,
                '$1$2<redacted>'
            )
            // The app's own tokens and keys, and anything else long and random-looking
            .replace(/\binternal_[A-Za-z0-9_-]+/g, '<token>')
            .replace(
                /\b(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{32,}\b/g,
                '<token>'
            )
    );
}

/** The message as stored: one string, scrubbed, at most MAX_MESSAGE characters. */
export function clean_message(value: unknown): string {
    let s = typeof value === 'string' ? value : value == null ? '' : String(value);
    s = scrub(s.replace(/\s+/g, ' ').trim());
    return clip(s || 'Unknown error', MAX_MESSAGE);
}

/** The stack as stored: scrubbed, at most MAX_STACK_LINES lines and MAX_STACK characters. */
export function clean_stack(value: unknown): string | null {
    if (typeof value !== 'string' || !value.trim()) return null;
    const lines = value
        .split('\n')
        .map(l => l.replace(/\s+$/, ''))
        .filter(Boolean)
        .slice(0, MAX_STACK_LINES);
    return clip(scrub(lines.join('\n')), MAX_STACK);
}

// A V8 frame ("    at fn (file:1:2)", "    at file:1:2") or a Firefox/Safari one ("fn@file:1:2")
const V8_FRAME = /^\s*at\s+(.*)$/;
const GECKO_FRAME = /^\s*[^@\s]*@(.+:\d+:\d+)\s*$/;

/** The first frame of a stack that's in our code, if it has one (else the first frame). */
export function top_frame(stack: string | null): string | null {
    if (!stack) return null;
    const frames: string[] = [];
    for (const line of stack.split('\n')) {
        const v8 = line.match(V8_FRAME);
        if (v8) frames.push(v8[1].trim());
        else if (GECKO_FRAME.test(line)) frames.push(line.trim());
    }
    if (frames.length === 0) return null;
    const ours = frames.find(f => !/node_modules|node:internal|\(node:|^node:|<anonymous>/.test(f));
    return clip(ours || frames[0], MAX_FIELD);
}

/**
 * The parts of a message and frame that change between occurrences of the same error (ids,
 * numbers, quoted values, a deploy's asset hashes, origins) are replaced, so they group.
 */
export function normalize_for_fingerprint(text: string): string {
    return text
        .replace(/\bhttps?:\/\/[^/\s)]+/gi, '')
        .replace(/-[A-Za-z0-9_]{8}\.(js|mjs|css)\b/g, '.$1')
        .replace(/"[^"]*"|'[^']*'|`[^`]*`/g, '<s>')
        .replace(/\b[0-9a-f]{8,}\b/gi, '<id>')
        .replace(/\d+/g, '<n>')
        .toLowerCase();
}

/** Groups occurrences of one error: its source, normalized message and top frame. */
export function fingerprint(source: ErrorSource, message: string, frame: string | null): string {
    const parts = [
        source,
        normalize_for_fingerprint(message),
        normalize_for_fingerprint(frame || '')
    ];
    return createHash('sha256').update(parts.join('\n')).digest('hex').slice(0, 24);
}

/** The route of a request as its pattern ("GET /web-file/:id"), never the ids or the query. */
export function route_of(method: unknown, route_path: unknown, path: unknown): string | null {
    const m = typeof method === 'string' ? method.toUpperCase() : '';
    let p: string | null = null;
    if (typeof route_path === 'string' && route_path) p = route_path;
    else if (typeof path === 'string' && path) {
        p = path
            .split('?')[0]
            .split('/')
            .map(seg => (/\d/.test(seg) && seg.length > 0 ? ':id' : seg))
            .join('/');
    }
    if (!p) return m || null;
    return clip(`${m} ${p}`.trim(), MAX_FIELD);
}

/** A server-side error (an exception, or whatever was thrown) as an event. */
export function server_event(
    source: 'api' | 'processor',
    ex: unknown,
    context: { route?: string | null; status?: number | null; account_id?: number | null } = {}
): ErrorEvent {
    const err: any = ex;
    const name = err && typeof err.name === 'string' && err.name !== 'Error' ? `${err.name}: ` : '';
    const message =
        err && typeof err.message === 'string'
            ? `${name}${err.message}`
            : typeof ex === 'string'
              ? ex
              : 'Non-error thrown';
    const stack = clean_stack(err && err.stack);
    const account_id = Number(context.account_id);
    return {
        source,
        message: clean_message(message),
        stack,
        top_frame: top_frame(stack),
        route: context.route ? clip(scrub(context.route), MAX_FIELD) : null,
        status: Number.isInteger(context.status) ? context.status : null,
        account_id: Number.isInteger(account_id) && account_id > 0 ? account_id : null,
        page: null,
        user_agent: null,
        kind: null
    };
}

const CLIENT_KINDS = ['error', 'unhandledrejection', 'vue'];

/**
 * A report the frontend posted (`POST /errors`): `{ message, stack?, page?, kind?, info? }`.
 * Everything is checked and cut down; the page loses its query string and hash.
 */
export function client_event(
    body: any,
    user_agent: unknown,
    account_id: number | null
): ErrorEvent {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        throw new ErrorReportError('Send a JSON object');
    }
    if (typeof body.message !== 'string' || !body.message.trim()) {
        throw new ErrorReportError('message is required');
    }
    const stack = clean_stack(typeof body.stack === 'string' ? body.stack : null);
    let page: string | null = null;
    if (typeof body.page === 'string' && body.page.startsWith('/')) {
        page = clip(scrub(body.page.split(/[?#]/)[0]), MAX_FIELD);
    }
    const kind = CLIENT_KINDS.includes(body.kind) ? body.kind : 'error';
    // Vue's errorHandler says where it was caught ("render function", "mounted hook")
    const info = typeof body.info === 'string' ? clip(scrub(body.info.trim()), 100) : '';
    return {
        source: 'frontend',
        message: clean_message(body.message),
        stack,
        top_frame: top_frame(stack),
        route: info || null,
        status: null,
        account_id: account_id && account_id > 0 ? account_id : null,
        page,
        user_agent: typeof user_agent === 'string' ? clip(user_agent, MAX_FIELD) : null,
        kind
    };
}

/** Whether a fingerprint's alert may go out now (none yet, or the last over an hour ago). */
export function alert_due(last_alert_at: Date | number | null | undefined, now: number): boolean {
    if (last_alert_at == null) return true;
    const t = new Date(last_alert_at).getTime();
    return !Number.isFinite(t) || now - t >= ALERT_EVERY_MS;
}

/** The Telegram message for a new error: plain text, already scrubbed. */
export function alert_text(event: ErrorEvent, admin_url: string | null): string {
    const lines = [`InvokeDB: new ${event.source} error`, event.message];
    if (event.top_frame) lines.push(`at ${event.top_frame}`);
    if (event.route) lines.push(`route: ${event.route}`);
    if (event.page) lines.push(`page: ${event.page}`);
    if (admin_url) lines.push(admin_url);
    return clip(lines.join('\n'), 1500);
}

export interface ErrorListQuery {
    source: ErrorSource | null;
    page: number;
    limit: number;
}

/** The admin list's `?source=&page=&limit=`. */
export function parse_error_query(query: any): ErrorListQuery {
    const q = query || {};
    let source: ErrorSource | null = null;
    if (q.source !== undefined && q.source !== '' && q.source !== 'all') {
        if (!ERROR_SOURCES.includes(q.source)) {
            throw new ErrorReportError(`source must be one of ${ERROR_SOURCES.join(', ')}`);
        }
        source = q.source;
    }
    const page = q.page === undefined ? 1 : Number(q.page);
    const limit = q.limit === undefined ? 25 : Number(q.limit);
    if (!Number.isInteger(page) || page < 1) throw new ErrorReportError('page must be 1 or more');
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
        throw new ErrorReportError('limit must be between 1 and 100');
    }
    return { source, page, limit };
}
