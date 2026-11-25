// Sends one webhook delivery (#140): a POST of the signed JSON body, refusing private and
// internal addresses on the address actually connected to (so a DNS answer can't change between
// the check and the connection). Redirects aren't followed: a 3xx counts as a failed attempt.
import * as http from 'http';
import * as https from 'https';
import * as dns from 'dns';
import { LookupFunction, isIP } from 'net';
import { is_private_address } from '../url-import/url-import';
import {
    PRIVATE_MSG,
    WEBHOOK_LIMITS,
    WebhookError,
    assert_webhook_url,
    is_test_host
} from './webhook';

export interface SendOptions {
    timeout_ms?: number;
    // Hosts ("127.0.0.1:8199") allowed although private: the smoke test's receiver
    test_hosts?: string[];
    // For tests only: the DNS lookup (default: the system's)
    lookup?: typeof dns.lookup;
}

export interface SendResult {
    // 0 if no answer came
    status: number;
    ms: number;
    // The start of the receiver's answer, or why the attempt failed
    response: string | null;
    error: string | null;
}

const RESPONSE_EXCERPT = 500;

function checked_lookup(allow_private: boolean, lookup = dns.lookup): LookupFunction {
    return ((hostname, options, callback) => {
        lookup(hostname, { ...options, all: true }, (err, addresses: any) => {
            if (err) return callback(err, '', 0);
            const list: dns.LookupAddress[] = Array.isArray(addresses)
                ? addresses
                : [{ address: addresses, family: 4 }];
            if (list.length === 0) {
                return callback(new WebhookError(`Could not resolve ${hostname}`), '', 0);
            }
            if (!allow_private && list.some(a => is_private_address(a.address))) {
                return callback(new WebhookError(PRIVATE_MSG), '', 0);
            }
            if ((options as any).all) return (callback as any)(null, list);
            callback(null, list[0].address, list[0].family);
        });
    }) as LookupFunction;
}

/** POSTs `body` to the webhook's URL with `headers`; never throws. */
export function send_webhook(
    url_text: string,
    body: string,
    headers: { [name: string]: string },
    opts: SendOptions = {}
): Promise<SendResult> {
    const start = Date.now();
    const timeout_ms = opts.timeout_ms || WEBHOOK_LIMITS.timeout_ms;
    const test_hosts = opts.test_hosts || [];
    const done = (status: number, response: string | null, error: string | null) => ({
        status,
        ms: Date.now() - start,
        response,
        error
    });

    let url: URL;
    try {
        url = new URL(url_text);
        assert_webhook_url(url, test_hosts);
    } catch (ex) {
        return Promise.resolve(done(0, null, ex.message || 'Invalid URL'));
    }
    const allow_private = is_test_host(url, test_hosts);
    const host = url.hostname.replace(/^\[|\]$/g, '');
    // An IP literal isn't looked up, so it's checked here
    if (isIP(host) && !allow_private && is_private_address(host)) {
        return Promise.resolve(done(0, null, PRIVATE_MSG));
    }

    return new Promise<SendResult>(resolve => {
        let settled = false;
        const finish = (r: SendResult) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve(r);
        };
        const client = url.protocol === 'https:' ? https : http;
        const req = client.request(
            url,
            {
                method: 'POST',
                lookup: checked_lookup(allow_private, opts.lookup),
                // A new connection every time, so every request goes through the lookup
                agent: false,
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': String(Buffer.byteLength(body)),
                    'User-Agent': 'InvokeDB-Webhook/1.0',
                    ...headers
                }
            },
            res => {
                const status = res.statusCode || 0;
                const chunks: Buffer[] = [];
                let size = 0;
                res.on('data', (chunk: Buffer) => {
                    if (size < RESPONSE_EXCERPT) chunks.push(chunk);
                    size += chunk.length;
                    // Only the start is kept; stop reading a long answer
                    if (size > 64 * 1024) res.destroy();
                });
                const end = () => {
                    const text = Buffer.concat(chunks).toString('utf8').slice(0, RESPONSE_EXCERPT);
                    const error =
                        status >= 200 && status < 300 ? null : `The URL answered HTTP ${status}`;
                    finish(done(status, text || null, error));
                };
                res.on('end', end);
                res.on('close', end);
                res.on('error', end);
            }
        );
        const timer = setTimeout(() => {
            req.destroy();
            finish(done(0, null, `No answer within ${Math.round(timeout_ms / 1000)} seconds`));
        }, timeout_ms);
        req.on('error', (err: any) => {
            const message =
                err instanceof WebhookError
                    ? err.message
                    : `Could not connect: ${(err && err.code) || (err && err.message)}`;
            finish(done(0, null, message));
        });
        req.end(body);
    });
}
