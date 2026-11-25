// Webhooks on row changes (#140). Pure rules only (no I/O): which URLs a webhook may call, which
// events it can pick, how a delivery is signed and checked, when a failed one is retried, and
// how changed rows become a payload. webhook-send.ts makes the request; webhook.manager.ts stores
// the webhooks and their deliveries.
import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { isIP } from 'net';
import { is_private_address } from '../url-import/url-import';

export const WEBHOOK_EVENTS = ['row.created', 'row.updated', 'row.deleted'] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];
// What "Send test event" sends
export const TEST_EVENT = 'ping';

export const WEBHOOK_LIMITS = {
    // Per account, until the plans in #137 set their own
    max_per_account: 10,
    max_url_length: 2048,
    // Rows in one delivery; a bigger change is sent as several
    max_rows_per_delivery: 100,
    // Each attempt must be answered within this
    timeout_ms: 10 * 1000,
    // A receiver must reject a signature older (or newer) than this
    signature_tolerance_sec: 5 * 60,
    // Deliveries shown in the app's log, per webhook
    log_size: 50,
    // Deliveries are kept this long, then Mongo removes them (a TTL index)
    keep_deliveries_days: 7
};

// Seconds to wait after each failed attempt; when they run out the delivery has failed.
// So a delivery is tried 7 times over about 7 hours.
export const RETRY_DELAYS_SEC = [5, 30, 120, 600, 3600, 6 * 3600];
export const MAX_ATTEMPTS = RETRY_DELAYS_SEC.length + 1;

export const SIGNATURE_HEADER = 'InvokeDB-Signature';

// A refusal the user can act on; the HTTP layer answers it with a 400
export class WebhookError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'WebhookError';
    }
}

const fail = (message: string): never => {
    throw new WebhookError(message);
};

export const PRIVATE_MSG = 'Webhook URLs on private or internal addresses are refused';

// Names that only mean something inside a network
const INTERNAL_SUFFIXES = ['localhost', 'local', 'internal', 'intranet', 'lan', 'home.arpa'];

/**
 * Checks a webhook URL: http(s) on the standard ports, no user name or password, and no host
 * that is an internal name or a private address (the sender checks every address the host
 * resolves to as well). `test_hosts` ("127.0.0.1:8199") are let through for the smoke test's
 * receiver; it's empty unless HORIZON_WEBHOOK_TEST_HOSTS is set.
 */
export function parse_webhook_url(input: unknown, test_hosts: string[] = []): string {
    if (typeof input !== 'string' || input.trim() === '') fail('A URL is required');
    const text = (input as string).trim();
    if (text.length > WEBHOOK_LIMITS.max_url_length) {
        fail(`The URL can't be longer than ${WEBHOOK_LIMITS.max_url_length} characters`);
    }
    let url: URL;
    try {
        url = new URL(text);
    } catch {
        fail('That is not a valid URL');
    }
    assert_webhook_url(url, test_hosts);
    url.hash = '';
    return url.toString();
}

/** True if the URL is one of the configured test receivers ("host:port"). */
export function is_test_host(url: URL, test_hosts: string[]) {
    return test_hosts.length > 0 && test_hosts.includes(url.host.toLowerCase());
}

/** The rules every URL a webhook calls must meet. */
export function assert_webhook_url(url: URL, test_hosts: string[] = []) {
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        fail('Only http and https webhook URLs are allowed');
    }
    if (url.username || url.password) fail("The URL can't contain a user name or password");
    if (is_test_host(url, test_hosts)) return;
    // url.port is '' for the scheme's default port (80 for http, 443 for https)
    if (!['', '80', '443'].includes(url.port)) {
        fail('Only URLs on the standard ports (80 and 443) are allowed');
    }
    // A trailing dot ("localhost.") is the same name
    const host = url.hostname
        .replace(/^\[|\]$/g, '')
        .replace(/\.+$/, '')
        .toLowerCase();
    if (!host) fail('The URL has no host');
    if (isIP(host)) {
        if (is_private_address(host)) fail(PRIVATE_MSG);
        return;
    }
    if (!host.includes('.') || INTERNAL_SUFFIXES.some(s => host === s || host.endsWith(`.${s}`))) {
        fail(PRIVATE_MSG);
    }
}

/** The events a webhook listens to: a non-empty list of WEBHOOK_EVENTS, no repeats. */
export function parse_events(input: unknown): WebhookEvent[] {
    if (!Array.isArray(input) || input.length === 0) {
        fail(`events must be a list of one or more of: ${WEBHOOK_EVENTS.join(', ')}`);
    }
    const events = input as unknown[];
    events.forEach(e => {
        if (!WEBHOOK_EVENTS.includes(e as WebhookEvent)) {
            fail(`Unknown event ${JSON.stringify(e)}: use ${WEBHOOK_EVENTS.join(', ')}`);
        }
    });
    return WEBHOOK_EVENTS.filter(e => events.includes(e));
}

/** A new signing secret, shown to the account so its receiver can check signatures. */
export function new_secret() {
    return `whsec_${randomBytes(24).toString('hex')}`;
}

export function new_id(prefix: string) {
    return `${prefix}_${randomBytes(12).toString('hex')}`;
}

/** The hex HMAC-SHA256 of `<timestamp>.<body>` with the webhook's secret. */
export function signature(secret: string, timestamp: number, body: string) {
    return createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}

/** The InvokeDB-Signature header for a body sent at `timestamp` (Unix seconds). */
export function signature_header(secret: string, timestamp: number, body: string) {
    return `t=${timestamp},v1=${signature(secret, timestamp, body)}`;
}

/**
 * What a receiver does with a delivery: true if the header is a valid signature of the body,
 * made within `tolerance_sec` of `now_sec`, so an old delivery can't be replayed.
 */
export function verify_signature(
    secret: string,
    body: string,
    header: unknown,
    now_sec: number,
    tolerance_sec = WEBHOOK_LIMITS.signature_tolerance_sec
): boolean {
    if (typeof header !== 'string') return false;
    const parts: { [k: string]: string[] } = {};
    header.split(',').forEach(part => {
        const i = part.indexOf('=');
        if (i <= 0) return;
        const k = part.slice(0, i).trim();
        (parts[k] = parts[k] || []).push(part.slice(i + 1).trim());
    });
    const t = parts.t && parts.t.length === 1 ? Number(parts.t[0]) : NaN;
    if (!Number.isInteger(t) || Math.abs(now_sec - t) > tolerance_sec) return false;
    const expected = Buffer.from(signature(secret, t, body), 'hex');
    return (parts.v1 || []).some(v => {
        if (!/^[0-9a-f]{64}$/.test(v)) return false;
        return timingSafeEqual(Buffer.from(v, 'hex'), expected);
    });
}

/** When to try again after `attempts` failed attempts, or null if the delivery has failed. */
export function next_retry_at(attempts: number, now: number): number | null {
    if (attempts < 1 || attempts >= MAX_ATTEMPTS) return null;
    return now + RETRY_DELAYS_SEC[attempts - 1] * 1000;
}

/** True for the HTTP statuses that count as delivered. */
export function is_delivered(status: number) {
    return status >= 200 && status < 300;
}

export interface PayloadColumn {
    field: string;
    headerName: string;
    deleted?: boolean;
}

/** A changed row as the API shows it: `_id` and a value per column name. */
export function payload_row(doc: any, columns: PayloadColumn[], format = (v: any) => v) {
    const row: any = { _id: String(doc._id) };
    columns.forEach(c => {
        if (c.deleted || typeof c.headerName !== 'string' || !c.headerName) return;
        const value = doc[c.field];
        row[c.headerName] = value === undefined ? null : format(value);
    });
    return row;
}

/** Splits a change into deliveries of at most max_rows_per_delivery rows. */
export function chunk_rows<T>(rows: T[], size = WEBHOOK_LIMITS.max_rows_per_delivery): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < rows.length; i += size) chunks.push(rows.slice(i, i + size));
    return chunks;
}

export interface DeliveryPayload {
    id: string;
    event: WebhookEvent | typeof TEST_EVENT;
    created_at: string;
    webhook_id: string;
    table: { id: number; name: string } | null;
    rows: any[];
}

/** The JSON body of a delivery. */
export function delivery_body(payload: DeliveryPayload) {
    return JSON.stringify(payload);
}

/** HORIZON_WEBHOOK_TEST_HOSTS ("127.0.0.1:8199,...") as a list. */
export function parse_test_hosts(value: string | undefined): string[] {
    if (!value) return [];
    return value
        .split(',')
        .map(s => s.trim().toLowerCase())
        .filter(Boolean);
}
