import {
    ALERT_EVERY_MS,
    ErrorReportError,
    MAX_MESSAGE,
    MAX_STACK_LINES,
    alert_due,
    alert_text,
    clean_message,
    clean_stack,
    client_event,
    fingerprint,
    parse_error_query,
    route_of,
    scrub,
    server_event,
    top_frame
} from './error-tracking';

const NODE_STACK = [
    "TypeError: Cannot read properties of undefined (reading 'id')",
    '    at WebFileService.update (/app/dist/application/web-file/web-file.service.js:120:31)',
    '    at async /app/node_modules/@nestjs/core/router/router-execution-context.js:46:28'
].join('\n');

const CHROME_STACK = [
    'TypeError: x is not a function',
    '    at Proxy.save (https://invokedb.com/assets/home-AbC12345.js:1:2345)',
    '    at https://invokedb.com/assets/vue-Xy9876zz.js:2:10'
].join('\n');

const FIREFOX_STACK =
    'save@https://invokedb.com/assets/home-AbC12345.js:1:2345\n@debugger eval code:1:1';

describe('scrub', () => {
    it('takes out emails, tokens, credentials and query strings', () => {
        const s = scrub(
            'user bob@example.com Bearer abc.def mongodb://admin:pw@db:27017/x ' +
                'https://api.invokedb.com/auth/verify-email?token=secret123 password=hunter2 ' +
                'internal_9f8e7d6c token: "zz"'
        );
        expect(s).not.toMatch(/bob@example\.com|abc\.def|admin:pw|secret123|hunter2|internal_9f/);
        expect(s).toContain('<email>');
        expect(s).toContain('Bearer <token>');
        expect(s).toContain('mongodb://<credentials>@db:27017/x');
        expect(s).toContain('https://api.invokedb.com/auth/verify-email?<query>');
        expect(s).toContain('password=<redacted>');
    });

    it('takes out long random strings such as API keys', () => {
        expect(scrub('key a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8 failed')).toBe('key <token> failed');
    });

    it('leaves file paths and ordinary words alone', () => {
        const line =
            'at WebFileService.update (/app/dist/application/web-file/web-file.service.js:120:31)';
        expect(scrub(line)).toBe(line);
    });
});

describe('clean_message and clean_stack', () => {
    it('cuts the message short and makes it one line', () => {
        expect(clean_message('a\n  b')).toBe('a b');
        expect(clean_message('x'.repeat(2000)).length).toBe(MAX_MESSAGE);
        expect(clean_message('')).toBe('Unknown error');
        expect(clean_message(undefined)).toBe('Unknown error');
    });

    it('keeps at most MAX_STACK_LINES lines', () => {
        const stack = Array.from({ length: 100 }, (_, i) => `    at f${i} (a.js:${i}:1)`).join(
            '\n'
        );
        expect(clean_stack(stack).split('\n')).toHaveLength(MAX_STACK_LINES);
        expect(clean_stack('')).toBeNull();
        expect(clean_stack(42)).toBeNull();
    });
});

describe('top_frame', () => {
    it("is the first frame in our code, not node_modules'", () => {
        expect(top_frame(NODE_STACK)).toBe(
            'WebFileService.update (/app/dist/application/web-file/web-file.service.js:120:31)'
        );
    });

    it('reads Chrome and Firefox stacks', () => {
        expect(top_frame(CHROME_STACK)).toBe(
            'Proxy.save (https://invokedb.com/assets/home-AbC12345.js:1:2345)'
        );
        expect(top_frame(FIREFOX_STACK)).toBe(
            'save@https://invokedb.com/assets/home-AbC12345.js:1:2345'
        );
    });

    it('is the first frame when none is ours, and null without frames', () => {
        expect(top_frame('Error\n    at node:internal/x:1:1')).toBe('node:internal/x:1:1');
        expect(top_frame('just a message')).toBeNull();
        expect(top_frame(null)).toBeNull();
    });
});

describe('fingerprint', () => {
    it('groups the same error with other ids, numbers, values and asset hashes', () => {
        const a = fingerprint('api', 'Table 123 not found for "x"', 'f (a.js:1:2)');
        const b = fingerprint('api', 'Table 456 not found for "y"', 'f (a.js:1:2)');
        expect(a).toBe(b);
        expect(a).toMatch(/^[0-9a-f]{24}$/);
        const c = fingerprint(
            'frontend',
            'x',
            'save (https://invokedb.com/assets/home-AbC12345.js:1:2)'
        );
        const d = fingerprint(
            'frontend',
            'x',
            'save (https://invokedb.com/assets/home-ZzZz9999.js:1:2)'
        );
        expect(c).toBe(d);
    });

    it('tells apart sources, messages and frames', () => {
        const base = fingerprint('api', 'boom', 'f (a.js:1:2)');
        expect(fingerprint('processor', 'boom', 'f (a.js:1:2)')).not.toBe(base);
        expect(fingerprint('api', 'bang', 'f (a.js:1:2)')).not.toBe(base);
        expect(fingerprint('api', 'boom', 'g (b.js:1:2)')).not.toBe(base);
    });
});

describe('route_of', () => {
    it("is the route's pattern, or the path with ids taken out", () => {
        expect(route_of('get', '/web-file/:id', '/web-file/12')).toBe('GET /web-file/:id');
        expect(route_of('POST', undefined, '/web-file/12/rows?x=1')).toBe(
            'POST /web-file/:id/rows'
        );
        expect(route_of(undefined, undefined, undefined)).toBeNull();
    });
});

describe('server_event', () => {
    it('keeps the name, message, stack, top frame and context', () => {
        const ex = new TypeError("Cannot read properties of undefined (reading 'id')");
        ex.stack = NODE_STACK;
        const e = server_event('api', ex, { route: 'GET /x', status: 500, account_id: 7 });
        expect(e.message).toBe("TypeError: Cannot read properties of undefined (reading 'id')");
        expect(e.top_frame).toContain('WebFileService.update');
        expect(e).toMatchObject({ source: 'api', route: 'GET /x', status: 500, account_id: 7 });
    });

    it('takes whatever was thrown', () => {
        expect(server_event('processor', 'oops').message).toBe('oops');
        expect(server_event('processor', { message: 'Table not found' }).message).toBe(
            'Table not found'
        );
        expect(server_event('processor', 42).message).toBe('Non-error thrown');
        expect(server_event('processor', null, { account_id: -1 }).account_id).toBeNull();
    });
});

describe('client_event', () => {
    it('checks and cuts down a report', () => {
        const e = client_event(
            {
                message: 'x is not a function',
                stack: CHROME_STACK,
                page: '/app/reset?token=abc#x',
                kind: 'vue',
                info: 'render function',
                extra: 'ignored'
            },
            'Mozilla/5.0',
            3
        );
        expect(e).toMatchObject({
            source: 'frontend',
            message: 'x is not a function',
            page: '/app/reset',
            kind: 'vue',
            route: 'render function',
            user_agent: 'Mozilla/5.0',
            account_id: 3
        });
        expect((e as any).extra).toBeUndefined();
        expect(e.top_frame).toContain('Proxy.save');
    });

    it('refuses a report without a message, and drops odd fields', () => {
        expect(() => client_event(null, null, null)).toThrow(ErrorReportError);
        expect(() => client_event([], null, null)).toThrow(ErrorReportError);
        expect(() => client_event({ message: '  ' }, null, null)).toThrow(ErrorReportError);
        const e = client_event({ message: 'm', page: 'https://evil', kind: 'nope' }, 5, null);
        expect(e).toMatchObject({ page: null, kind: 'error', user_agent: null, account_id: null });
    });
});

describe('alerts', () => {
    it('are due once per hour per fingerprint', () => {
        const now = 10 * ALERT_EVERY_MS;
        expect(alert_due(null, now)).toBe(true);
        expect(alert_due(new Date(now - ALERT_EVERY_MS + 1), now)).toBe(false);
        expect(alert_due(now - ALERT_EVERY_MS, now)).toBe(true);
    });

    it('say the source, message, frame and where to look', () => {
        const e = client_event({ message: 'boom', stack: CHROME_STACK, page: '/app' }, null, null);
        const text = alert_text(e, 'https://invokedb.com/app/admin?error=abc');
        expect(text).toContain('new frontend error');
        expect(text).toContain('boom');
        expect(text).toContain('at Proxy.save');
        expect(text).toContain('page: /app');
        expect(text).toContain('https://invokedb.com/app/admin?error=abc');
    });
});

describe('parse_error_query', () => {
    it('has defaults and checks each value', () => {
        expect(parse_error_query({})).toEqual({ source: null, page: 1, limit: 25 });
        expect(parse_error_query({ source: 'all' }).source).toBeNull();
        expect(parse_error_query({ source: 'frontend', page: '2', limit: '50' })).toEqual({
            source: 'frontend',
            page: 2,
            limit: 50
        });
        expect(() => parse_error_query({ source: 'db' })).toThrow(ErrorReportError);
        expect(() => parse_error_query({ page: '0' })).toThrow(ErrorReportError);
        expect(() => parse_error_query({ limit: '101' })).toThrow(ErrorReportError);
    });
});
