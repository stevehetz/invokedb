// Error tracking (#212): the browser's unhandled errors (window `error`, `unhandledrejection`)
// and the ones Vue catches (app.config.errorHandler) are posted to the backend's POST /errors,
// which keeps them for the admin's Errors page. Only the message, the stack, the page's path
// (no query string) and how it was caught are sent, at most MAX_REPORTS per page load and each
// distinct error once.
import { store } from '@/store';

export const MAX_REPORTS = 10;

// Noise that says nothing about our code: a cross-origin script's hidden error, the browser's
// ResizeObserver warning, and errors from browser extensions
const IGNORED_MESSAGES = [/^Script error\.?$/i, /ResizeObserver loop/i];
const EXTENSION_FRAME = /(chrome|moz|safari(-web)?)-extension:\/\//;

/** @param {any} reason @returns {{ message: string, stack: string } | null} */
export function describe_error(reason) {
    if (reason instanceof Error) {
        const message =
            reason.name && reason.name !== 'Error'
                ? `${reason.name}: ${reason.message}`
                : reason.message;
        return { message: message || reason.name, stack: reason.stack || '' };
    }
    if (typeof reason === 'string' && reason.trim()) {
        return { message: reason, stack: '' };
    }
    // `undefined` is a failed request (request.js) and a plain object is the backend's error
    // body: the backend already knows about both
    return null;
}

/** @param {{ message: string, stack: string }} e */
export function ignored(e) {
    return (
        IGNORED_MESSAGES.some(re => re.test(e.message)) ||
        EXTENSION_FRAME.test(e.stack)
    );
}

/**
 * The key that makes each distinct error be sent once per page load.
 * @param {{ message: string, stack: string }} e
 */
export function report_key(e) {
    const frame = e.stack.split('\n').find(l => /:\d+:\d+/.test(l)) || '';
    return `${e.message}\n${frame.trim()}`;
}

const session = (
    globalThis.crypto && crypto.randomUUID
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`
).replace(/[^A-Za-z0-9-]/g, '');

/** @type {Set<string>} */
const seen = new Set();
/** @type {any[]} */
const waiting = [];
let sent = 0;

/** @param {any} body */
function send(body) {
    const env = store.get('env');
    if (!env || !env.HORIZON_BE_PUB_HTTP_URL) {
        waiting.push(body);
        return;
    }
    const account = store.get('account');
    /** @type {Record<string, string>} */
    const headers = { 'Content-Type': 'application/json' };
    if (account && account.token)
        headers.Authorization = `BEARER ${account.token}`;
    fetch(`${env.HORIZON_BE_PUB_HTTP_URL}/errors`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        keepalive: true
    }).catch(() => {});
}

/**
 * @param {'error' | 'unhandledrejection' | 'vue'} kind
 * @param {any} reason
 * @param {string} [info] where Vue caught it
 */
export function report_error(kind, reason, info) {
    try {
        const e = describe_error(reason);
        if (!e || ignored(e)) return;
        const key = report_key(e);
        if (seen.has(key) || sent >= MAX_REPORTS) return;
        seen.add(key);
        sent++;
        send({
            message: e.message.slice(0, 1000),
            stack: e.stack.slice(0, 8000),
            page: window.location.pathname,
            kind,
            info: info || undefined,
            session
        });
    } catch {
        // Reporting must never throw
    }
}

/** @param {import('vue').App} app */
export function install_error_reporting(app) {
    window.addEventListener('error', event => {
        // A failed <img>/<script> load has no error object or message
        if (!event.error && !event.message) return;
        report_error(
            'error',
            event.error ||
                new Error(
                    event.filename
                        ? `${event.message} (${event.filename}:${event.lineno}:${event.colno})`
                        : event.message
                )
        );
    });
    window.addEventListener('unhandledrejection', event =>
        report_error('unhandledrejection', event.reason)
    );
    // Setting a handler stops Vue logging the error itself, so it's logged here
    app.config.errorHandler = (err, _instance, info) => {
        console.error(err);
        report_error('vue', err, info);
    };
    // Errors from before the runtime env (env.txt) was loaded
    store.subscribe('env', env => {
        if (!env) return;
        waiting.splice(0).forEach(send);
    });
}
