// JSON requests with a bearer token. Replaces the old `$.ajax` calls and keeps their contract:
// resolves with the parsed body (JSON when the response says so, else text), and rejects with
// the parsed JSON error body (`{ status, message, rules? }` from the backend) or undefined.
export async function request(method, url, token, data) {
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
    let body = text;
    if (is_json && text) {
        try {
            body = JSON.parse(text);
        } catch (ex) {
            if (res.ok) throw undefined; // jQuery treated a bad JSON body as a failure
            body = undefined;
        }
    }

    if (!res.ok) throw is_json ? body : undefined;
    // Some endpoints answer 200 with an error object
    if (body && body.status >= 400) throw body;
    return body;
}
