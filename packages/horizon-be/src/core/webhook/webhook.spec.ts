import {
    MAX_ATTEMPTS,
    RETRY_DELAYS_SEC,
    WEBHOOK_LIMITS,
    WebhookError,
    chunk_rows,
    is_delivered,
    new_secret,
    next_retry_at,
    parse_events,
    parse_test_hosts,
    parse_webhook_url,
    payload_row,
    signature,
    signature_header,
    verify_signature
} from './webhook';

const refused = (input: unknown, test_hosts: string[] = []) => {
    try {
        parse_webhook_url(input, test_hosts);
    } catch (ex) {
        expect(ex).toBeInstanceOf(WebhookError);
        return ex.message;
    }
    throw new Error(`expected ${JSON.stringify(input)} to be refused`);
};

describe('parse_webhook_url', () => {
    it('takes public http(s) URLs and drops the fragment', () => {
        expect(parse_webhook_url(' https://hooks.example.com/in?x=1#frag ')).toBe(
            'https://hooks.example.com/in?x=1'
        );
        expect(parse_webhook_url('http://93.184.216.34/hook')).toBe('http://93.184.216.34/hook');
    });

    it('refuses private, loopback and internal addresses', () => {
        for (const url of [
            'http://127.0.0.1/hook',
            'http://localhost/hook',
            'http://localhost./hook',
            'http://10.0.0.5/hook',
            'http://192.168.1.1/hook',
            'http://169.254.169.254/latest/meta-data',
            'http://[::1]/hook',
            'http://[::ffff:127.0.0.1]/hook',
            'http://db.internal/hook',
            'http://printer.local/hook',
            'http://intranet/hook'
        ]) {
            expect(refused(url)).toMatch(/private or internal/);
        }
    });

    it('refuses other schemes, ports, credentials and bad input', () => {
        expect(refused('ftp://example.com/a')).toMatch(/http and https/);
        expect(refused('https://example.com:8443/a')).toMatch(/standard ports/);
        expect(refused('https://u:p@example.com/a')).toMatch(/user name or password/);
        expect(refused('not a url')).toMatch(/not a valid URL/);
        expect(refused('')).toMatch(/required/);
        expect(refused(42)).toMatch(/required/);
        expect(refused(`https://example.com/${'a'.repeat(WEBHOOK_LIMITS.max_url_length)}`)).toMatch(
            /longer than/
        );
    });

    it('lets only the configured test host and port through', () => {
        const test = ['127.0.0.1:8199'];
        expect(parse_webhook_url('http://127.0.0.1:8199/hook', test)).toBe(
            'http://127.0.0.1:8199/hook'
        );
        expect(refused('http://127.0.0.1:8198/hook', test)).toMatch(/standard ports/);
        expect(refused('http://127.0.0.1/hook', test)).toMatch(/private or internal/);
        expect(refused('http://10.0.0.1:8199/hook', test)).toMatch(/standard ports/);
    });
});

describe('parse_test_hosts', () => {
    it('splits and normalises the list', () => {
        expect(parse_test_hosts(undefined)).toEqual([]);
        expect(parse_test_hosts('')).toEqual([]);
        expect(parse_test_hosts(' 127.0.0.1:8199 , Example.com:81,')).toEqual([
            '127.0.0.1:8199',
            'example.com:81'
        ]);
    });
});

describe('parse_events', () => {
    it('keeps known events once, in a fixed order', () => {
        expect(parse_events(['row.deleted', 'row.created', 'row.deleted'])).toEqual([
            'row.created',
            'row.deleted'
        ]);
    });

    it('refuses an empty list, a non-list and unknown events', () => {
        expect(() => parse_events([])).toThrow(WebhookError);
        expect(() => parse_events('row.created')).toThrow(WebhookError);
        expect(() => parse_events(['row.created', 'table.deleted'])).toThrow(/Unknown event/);
    });
});

describe('signatures', () => {
    const secret = 'whsec_test';
    const body = '{"event":"row.created","rows":[]}';
    const now = 1_800_000_000;

    it('signs <timestamp>.<body> with HMAC-SHA256', () => {
        const crypto = require('crypto');
        const expected = crypto.createHmac('sha256', secret).update(`${now}.${body}`).digest('hex');
        expect(signature(secret, now, body)).toBe(expected);
        expect(signature_header(secret, now, body)).toBe(`t=${now},v1=${expected}`);
    });

    it('verifies a fresh signature', () => {
        const header = signature_header(secret, now, body);
        expect(verify_signature(secret, body, header, now)).toBe(true);
        expect(verify_signature(secret, body, header, now + 299)).toBe(true);
    });

    it('rejects an old or future timestamp (a replay)', () => {
        const header = signature_header(secret, now, body);
        expect(verify_signature(secret, body, header, now + 301)).toBe(false);
        expect(verify_signature(secret, body, header, now - 301)).toBe(false);
    });

    it('rejects another body, secret or timestamp', () => {
        const header = signature_header(secret, now, body);
        expect(verify_signature(secret, body + ' ', header, now)).toBe(false);
        expect(verify_signature('whsec_other', body, header, now)).toBe(false);
        const moved = header.replace(`t=${now}`, `t=${now + 1}`);
        expect(verify_signature(secret, body, moved, now)).toBe(false);
    });

    it('rejects malformed headers', () => {
        for (const header of [undefined, '', 'v1=abc', `t=${now}`, `t=${now},v1=zz`, 42]) {
            expect(verify_signature(secret, body, header, now)).toBe(false);
        }
        const sig = signature(secret, now, body);
        expect(verify_signature(secret, body, `t=${now},t=${now},v1=${sig}`, now)).toBe(false);
    });

    it('accepts any matching v1 (several, while a secret is rotated)', () => {
        const sig = signature(secret, now, body);
        const header = `t=${now},v1=${'0'.repeat(64)},v1=${sig}`;
        expect(verify_signature(secret, body, header, now)).toBe(true);
    });

    it('makes a different secret each time', () => {
        const a = new_secret();
        expect(a).toMatch(/^whsec_[0-9a-f]{48}$/);
        expect(new_secret()).not.toBe(a);
    });
});

describe('retries', () => {
    it('backs off after each failed attempt, then gives up', () => {
        const now = 1_000_000;
        RETRY_DELAYS_SEC.forEach((delay, i) => {
            expect(next_retry_at(i + 1, now)).toBe(now + delay * 1000);
        });
        expect(next_retry_at(MAX_ATTEMPTS, now)).toBeNull();
        expect(next_retry_at(0, now)).toBeNull();
        // Each wait is longer than the one before
        RETRY_DELAYS_SEC.slice(1).forEach((d, i) => expect(d).toBeGreaterThan(RETRY_DELAYS_SEC[i]));
    });

    it('counts only 2xx as delivered', () => {
        expect(is_delivered(200)).toBe(true);
        expect(is_delivered(204)).toBe(true);
        expect(is_delivered(301)).toBe(false);
        expect(is_delivered(500)).toBe(false);
        expect(is_delivered(0)).toBe(false);
    });
});

describe('payload rows', () => {
    const columns = [
        { field: 'a', headerName: 'name' },
        { field: 'b', headerName: 'age' },
        { field: 'c', headerName: 'gone', deleted: true }
    ];

    it('names values by column and leaves out internal fields', () => {
        const doc = { _id: { toString: () => 'abc' }, a: 'alice', c: 'x', row_index: 3 };
        expect(payload_row(doc, columns)).toEqual({ _id: 'abc', name: 'alice', age: null });
    });

    it('formats values with the given function', () => {
        const doc = { _id: '1', a: 'alice', b: 30 };
        expect(payload_row(doc, columns, v => `<${v}>`)).toEqual({
            _id: '1',
            name: '<alice>',
            age: '<30>'
        });
    });

    it('splits big changes into deliveries', () => {
        const rows = Array.from({ length: 250 }, (_, i) => i);
        const chunks = chunk_rows(rows);
        expect(chunks.map(c => c.length)).toEqual([100, 100, 50]);
        expect(chunks.flat()).toEqual(rows);
        expect(chunk_rows([])).toEqual([]);
    });
});
