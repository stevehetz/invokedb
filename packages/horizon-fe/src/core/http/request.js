// JSON requests with a bearer token. Replaces the old `$.ajax` calls: resolves with the parsed
// body (JSON when the response says so, else text), and rejects with the parsed JSON error body
// (`{ status, message, rules? }` from the backend). A failure with no such body (the network is
// down, a non-JSON error page) rejects with `{ status, message }` too, never with undefined
// (#378): a `catch` that read `ex.status` threw on undefined before it could clear its busy
// state, which left dialogs, the grid's overlay and forms stuck.
import { bus } from '@/core/bus';

export const NETWORK_ERROR_MESSAGE =
    'Could not reach InvokeDB. Check your connection and try again.';

/**
 * @param {number} status
 * @param {string} message
 */
function failure(status, message) {
    return { status, message };
}

/** @returns {Promise<any>} */
export async function request(method, url, token, data) {
    /** @type {RequestInit} */
    const options = {
        method,
        headers: {
            'Content-Type': 'application/json',
            Authorization: `BEARER ${token}`
        }
    };
    if (data !== undefined) options.body = JSON.stringify(data);

    let res;
    try {
        res = await fetch(url, options);
    } catch (ex) {
        // Network error (server down, offline, CORS)
        throw failure(0, NETWORK_ERROR_MESSAGE);
    }

    // A refused login token (#378): the app's shell checks whether the session has ended
    // (a 401 also answers another account's table, so this alone doesn't sign anyone out)
    if (res.status === 401 && token) bus.$emit('session:unauthorized');

    const text = await res.text();
    const is_json = (res.headers.get('content-type') || '').includes('json');
    /** @type {any} */
    let body = text;
    if (is_json && text) {
        try {
            body = JSON.parse(text);
        } catch (ex) {
            // A bad JSON body is a failure, as it was with jQuery
            if (res.ok)
                throw failure(
                    res.status,
                    "The server's answer couldn't be read"
                );
            body = undefined;
        }
    }

    // A refusal at the plan's cap (#183): the app shows a notice that links to the usage
    // A write by a read-only account (#184, `plan_read_only`) shows the same notice
    // A feature that's off in the no-signup demo (#333, `demo_account`) too, with a signup link
    if (
        body &&
        (body.code === 'plan_limit' ||
            body.code === 'plan_read_only' ||
            body.code === 'demo_account')
    )
        bus.$emit('plan_limit', body);
    if (!res.ok) {
        if (is_json && body && typeof body === 'object') throw body;
        throw failure(
            res.status,
            `The server answered with an error (${res.status})`
        );
    }
    // Some endpoints answer 200 with an error object
    if (body && body.status >= 400) throw body;
    return body;
}
