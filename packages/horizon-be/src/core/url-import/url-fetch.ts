// Fetches an import URL (#144) with the limits in URL_IMPORT_LIMITS: http(s) on the standard
// ports, no private or internal addresses (checked on the address actually connected to, so a
// DNS answer can't change between the check and the connection), a few redirects (each
// checked again), a size cap and an overall time limit.
import * as http from 'http';
import * as https from 'https';
import * as dns from 'dns';
import { LookupFunction, isIP } from 'net';
import {
    URL_IMPORT_LIMITS,
    UrlImportError,
    assert_fetchable_url,
    is_private_address
} from './url-import';

export interface FetchOptions {
    max_bytes?: number;
    timeout_ms?: number;
    max_redirects?: number;
    // For tests only: which addresses may be connected to (default: public ones only)
    allow_address?: (address: string) => boolean;
    // For tests only: the DNS lookup (default: the system's)
    lookup?: typeof dns.lookup;
    // For tests only: ports allowed besides 80 and 443
    extra_ports?: string[];
}

export interface FetchResult {
    body: string;
    content_type: string | undefined;
    // The URL the body came from, after redirects
    url: string;
}

const PRIVATE_MSG = 'URLs on private or internal addresses are refused';

// A dns.lookup that refuses a host if any address it resolves to is private
function checked_lookup(opts: FetchOptions): LookupFunction {
    const allow = opts.allow_address || (a => !is_private_address(a));
    const lookup = opts.lookup || dns.lookup;
    return ((hostname, options, callback) => {
        lookup(hostname, { ...options, all: true }, (err, addresses: any) => {
            if (err) return callback(err, '', 0);
            const list: dns.LookupAddress[] = Array.isArray(addresses)
                ? addresses
                : [{ address: addresses, family: 4 }];
            if (list.length === 0) {
                return callback(new UrlImportError(`Could not resolve ${hostname}`), '', 0);
            }
            if (list.some(a => !allow(a.address))) {
                return callback(new UrlImportError(PRIVATE_MSG), '', 0);
            }
            if ((options as any).all) return (callback as any)(null, list);
            callback(null, list[0].address, list[0].family);
        });
    }) as LookupFunction;
}

/** Resolves a URL's host and refuses it if it's private; for a quick check before queueing. */
export async function assert_public_host(url_text: string, opts: FetchOptions = {}) {
    const url = new URL(url_text);
    assert_fetchable_url(url, opts.extra_ports);
    const host = url.hostname.replace(/^\[|\]$/g, '');
    const lookup = checked_lookup(opts);
    await new Promise<void>((resolve, reject) => {
        lookup(host, {}, err => {
            if (!err) return resolve();
            reject(
                err instanceof UrlImportError
                    ? err
                    : new UrlImportError(`Could not resolve ${host}`)
            );
        });
    });
}

function request_once(url: URL, opts: FetchOptions, signal: AbortSignal, max_bytes: number) {
    return new Promise<{ status: number; location?: string; body?: Buffer; type?: string }>(
        (resolve, reject) => {
            const host = url.hostname.replace(/^\[|\]$/g, '');
            // An IP literal isn't looked up, so it's checked here
            const allow = opts.allow_address || (a => !is_private_address(a));
            if (isIP(host) && !allow(host)) {
                return reject(new UrlImportError(PRIVATE_MSG));
            }
            const client = url.protocol === 'https:' ? https : http;
            const req = client.get(
                url,
                {
                    lookup: checked_lookup(opts),
                    // A new connection every time, so every request goes through the lookup
                    agent: false,
                    signal,
                    headers: {
                        'User-Agent': 'InvokeDB-Import/1.0',
                        Accept: 'text/csv, application/json;q=0.9, */*;q=0.5',
                        'Accept-Encoding': 'identity'
                    }
                },
                res => {
                    const status = res.statusCode || 0;
                    if (status >= 300 && status < 400 && res.headers.location) {
                        res.resume();
                        return resolve({ status, location: res.headers.location });
                    }
                    if (status < 200 || status >= 300) {
                        res.resume();
                        return reject(new UrlImportError(`The URL answered HTTP ${status}`));
                    }
                    const length = Number(res.headers['content-length']);
                    if (length > max_bytes) {
                        res.destroy();
                        return reject(too_large(max_bytes));
                    }
                    const chunks: Buffer[] = [];
                    let size = 0;
                    res.on('data', (chunk: Buffer) => {
                        size += chunk.length;
                        if (size > max_bytes) {
                            res.destroy();
                            req.destroy();
                            reject(too_large(max_bytes));
                            return;
                        }
                        chunks.push(chunk);
                    });
                    res.on('end', () =>
                        resolve({
                            status,
                            body: Buffer.concat(chunks),
                            type: res.headers['content-type']
                        })
                    );
                    res.on('error', reject);
                }
            );
            req.on('error', reject);
        }
    );
}

const too_large = (max_bytes: number) =>
    new UrlImportError(`The file is larger than the ${Math.round(max_bytes / 1048576)} MB limit`);

/** Downloads a URL's body as text, following up to max_redirects checked redirects. */
export async function fetch_source(
    url_text: string,
    opts: FetchOptions = {}
): Promise<FetchResult> {
    const max_bytes = opts.max_bytes || URL_IMPORT_LIMITS.max_bytes;
    const timeout_ms = opts.timeout_ms || URL_IMPORT_LIMITS.timeout_ms;
    const max_redirects =
        opts.max_redirects === undefined ? URL_IMPORT_LIMITS.max_redirects : opts.max_redirects;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout_ms);
    try {
        let url = new URL(url_text);
        for (let redirects = 0; ; redirects++) {
            assert_fetchable_url(url, opts.extra_ports);
            let res;
            try {
                res = await request_once(url, opts, controller.signal, max_bytes);
            } catch (err) {
                if (controller.signal.aborted) {
                    throw new UrlImportError(
                        `The URL took longer than ${Math.round(timeout_ms / 1000)} seconds to answer`
                    );
                }
                if (err instanceof UrlImportError) throw err;
                throw new UrlImportError(
                    `Could not fetch the URL: ${(err && err.code) || err.message}`
                );
            }
            if (res.location) {
                if (redirects >= max_redirects) throw new UrlImportError('Too many redirects');
                url = new URL(res.location, url);
                continue;
            }
            return { body: res.body.toString('utf8'), content_type: res.type, url: url.toString() };
        }
    } finally {
        clearTimeout(timer);
    }
}
