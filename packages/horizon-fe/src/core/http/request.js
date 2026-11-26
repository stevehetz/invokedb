// JSON requests with a bearer token. Replaces the old `$.ajax` calls and keeps their contract:
// resolves with the parsed body (JSON when the response says so, else text), and rejects with
// the parsed JSON error body (`{ status, message, rules? }` from the backend) or undefined.
import { bus } from '@/core/bus';

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
        // Network error (server down, CORS): jQuery rejected with no response body
        throw undefined;
    }

    const text = await res.text();
    const is_json = (res.headers.get('content-type') || '').includes('json');
    /** @type {any} */
    let body = text;
    if (is_json && text) {
        try {
            body = JSON.parse(text);
        } catch (ex) {
            if (res.ok) throw undefined; // jQuery treated a bad JSON body as a failure
            body = undefined;
        }
    }

    // A refusal at the plan's cap (#183): the app shows a notice that links to the usage
    // A write by a read-only account (#184, `plan_read_only`) shows the same notice
    if (body && (body.code === 'plan_limit' || body.code === 'plan_read_only'))
        bus.$emit('plan_limit', body);
    if (!res.ok) throw is_json ? body : undefined;
    // Some endpoints answer 200 with an error object
    if (body && body.status >= 400) throw body;
    return body;
}
