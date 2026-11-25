import {
    UrlImportError,
    body_to_csv,
    google_sheet_csv_url,
    is_private_address,
    json_to_csv,
    next_sync_at,
    parse_source_url,
    parse_sync_settings
} from './url-import';

const refused = (fn: () => unknown, message?: RegExp) => {
    let err;
    try {
        fn();
    } catch (ex) {
        err = ex;
    }
    expect(err).toBeInstanceOf(UrlImportError);
    if (message) expect(err.message).toMatch(message);
};

describe('google_sheet_csv_url', () => {
    const sheet = (u: string) => google_sheet_csv_url(new URL(u));

    it('turns a shared sheet link into its CSV export, keeping the tab', () => {
        expect(sheet('https://docs.google.com/spreadsheets/d/1AbC_d-9/edit#gid=42')).toBe(
            'https://docs.google.com/spreadsheets/d/1AbC_d-9/export?format=csv&gid=42'
        );
        expect(sheet('https://docs.google.com/spreadsheets/d/1AbC/edit?usp=sharing')).toBe(
            'https://docs.google.com/spreadsheets/d/1AbC/export?format=csv'
        );
        expect(sheet('https://docs.google.com/spreadsheets/d/1AbC/edit?gid=7#gid=7')).toBe(
            'https://docs.google.com/spreadsheets/d/1AbC/export?format=csv&gid=7'
        );
    });

    it('turns a published sheet into its CSV output', () => {
        expect(sheet('https://docs.google.com/spreadsheets/d/e/2PACX-1v/pubhtml')).toBe(
            'https://docs.google.com/spreadsheets/d/e/2PACX-1v/pub?output=csv'
        );
        expect(
            sheet('https://docs.google.com/spreadsheets/d/e/2PACX-1v/pubhtml?gid=3&single=true')
        ).toBe(
            'https://docs.google.com/spreadsheets/d/e/2PACX-1v/pub?output=csv&gid=3&single=true'
        );
    });

    it('leaves other URLs alone', () => {
        expect(sheet('https://docs.google.com/document/d/1AbC/edit')).toBeNull();
        expect(sheet('https://example.com/spreadsheets/d/1AbC/edit')).toBeNull();
    });
});

describe('parse_source_url', () => {
    it('accepts http(s) URLs and drops the fragment', () => {
        expect(parse_source_url(' https://example.com/data.csv#top ')).toEqual({
            url: 'https://example.com/data.csv#top',
            fetch_url: 'https://example.com/data.csv',
            kind: 'url'
        });
        expect(parse_source_url('http://example.com:80/a.json').fetch_url).toBe(
            'http://example.com/a.json'
        );
        expect(parse_source_url('https://docs.google.com/spreadsheets/d/x/edit').kind).toBe(
            'google_sheet'
        );
    });

    it('refuses other schemes, credentials and odd ports', () => {
        refused(() => parse_source_url('file:///etc/passwd'), /http and https/);
        refused(() => parse_source_url('ftp://example.com/a.csv'), /http and https/);
        refused(() => parse_source_url('gopher://example.com/'), /http and https/);
        refused(() => parse_source_url('https://user:pw@example.com/a.csv'), /user name/);
        refused(() => parse_source_url('https://example.com:8443/a.csv'), /standard ports/);
        refused(() => parse_source_url('http://example.com:6379/'), /standard ports/);
        refused(() => parse_source_url(''), /required/);
        refused(() => parse_source_url(42), /required/);
        refused(() => parse_source_url('not a url'), /valid URL/);
        refused(() => parse_source_url(`https://example.com/${'a'.repeat(3000)}`), /longer/);
    });

    it('refuses private addresses and internal names, however they are written', () => {
        [
            'http://127.0.0.1/',
            'http://127.1/',
            'http://0x7f.0.0.1/',
            'http://2130706433/',
            'http://0.0.0.0/',
            'http://10.1.2.3/',
            'http://172.16.0.1/',
            'http://192.168.1.1/',
            'http://169.254.169.254/latest/meta-data/',
            'http://100.64.0.1/',
            'http://[::1]/',
            'http://[::]/',
            'http://[::ffff:127.0.0.1]/',
            'http://[::ffff:7f00:1]/',
            'http://[fd00::1]/',
            'http://[fe80::1]/',
            'http://localhost/',
            'http://LOCALHOST./',
            'http://api.localhost/',
            'http://printer.local/',
            'http://metadata.google.internal/',
            'http://intranet/'
        ].forEach(u => refused(() => parse_source_url(u), /private or internal/));
    });

    it('accepts public addresses', () => {
        expect(parse_source_url('http://93.184.215.14/a.csv').kind).toBe('url');
        expect(parse_source_url('http://[2606:4700::1111]/a.csv').kind).toBe('url');
    });
});

describe('is_private_address', () => {
    it('knows the private and special ranges', () => {
        [
            '127.0.0.1',
            '10.0.0.1',
            '172.31.255.255',
            '192.168.0.1',
            '169.254.0.1',
            '100.127.0.1',
            '0.1.2.3',
            '224.0.0.1',
            '255.255.255.255',
            '198.18.0.1',
            '::1',
            '::',
            'fc00::1',
            'fdff::1',
            'fe80::1%eth0',
            'ff02::1',
            '::ffff:10.0.0.1',
            '::ffff:0:127.0.0.1',
            '64:ff9b::a9fe:a9fe', // NAT64 of 169.254.169.254
            '2002:7f00:1::', // 6to4 of 127.0.0.1
            '2001:db8::1',
            'not-an-ip'
        ].forEach(a => expect([a, is_private_address(a)]).toEqual([a, true]));
    });

    it('lets public addresses through', () => {
        [
            '8.8.8.8',
            '1.1.1.1',
            '172.32.0.1',
            '93.184.215.14',
            '2606:4700:4700::1111',
            '::ffff:8.8.8.8',
            '2002:808:808::'
        ].forEach(a => expect([a, is_private_address(a)]).toEqual([a, false]));
    });
});

describe('parse_sync_settings', () => {
    it('defaults to replace, never scheduled', () => {
        expect(parse_sync_settings({})).toEqual({
            mode: 'replace',
            key_column: null,
            schedule: 'off'
        });
    });

    it('needs a key column to upsert, and drops it for a replace', () => {
        refused(() => parse_sync_settings({ mode: 'upsert' }), /key_column/);
        refused(() => parse_sync_settings({ mode: 'upsert', key_column: '  ' }), /key_column/);
        expect(parse_sync_settings({ mode: 'upsert', key_column: ' email ' })).toEqual({
            mode: 'upsert',
            key_column: 'email',
            schedule: 'off'
        });
        expect(parse_sync_settings({ mode: 'replace', key_column: 'email' }).key_column).toBe(null);
    });

    it('refuses unknown values', () => {
        refused(() => parse_sync_settings({ mode: 'merge' }), /mode/);
        refused(() => parse_sync_settings({ schedule: 'every-minute' }), /schedule/);
        refused(() => parse_sync_settings({ mode: 'upsert', key_column: 3 }), /string/);
    });

    it('keeps what an update leaves out', () => {
        const current = { mode: 'upsert', key_column: 'id', schedule: 'daily' } as const;
        expect(parse_sync_settings({ schedule: 'hourly' }, current)).toEqual({
            mode: 'upsert',
            key_column: 'id',
            schedule: 'hourly'
        });
        expect(parse_sync_settings({ mode: 'replace' }, current).key_column).toBeNull();
    });
});

describe('next_sync_at', () => {
    it('is an hour or a day on, or never', () => {
        expect(next_sync_at('off', 1000)).toBeNull();
        expect(next_sync_at('hourly', 1000)).toBe(1000 + 3600 * 1000);
        expect(next_sync_at('daily', 1000)).toBe(1000 + 86400 * 1000);
    });
});

describe('json_to_csv', () => {
    it('turns an array of objects into CSV, every key a column', () => {
        expect(
            json_to_csv([
                { name: 'Ann', age: 30 },
                { name: 'Bo, Jr.', city: 'Oslo', tags: ['a', 'b'], ok: true, none: null }
            ])
        ).toBe('name,age,city,tags,ok,none\nAnn,30,,,,\n"Bo, Jr.",,Oslo,"[""a"",""b""]",true,\n');
    });

    it('finds the rows inside an object', () => {
        expect(json_to_csv({ data: [{ a: 1 }] })).toBe('a\n1\n');
        expect(json_to_csv({ columns: [{ name: 'x' }], rows: [{ x: 'y' }] })).toBe('x\ny\n');
        expect(json_to_csv({ meta: {}, people: [{ a: 'line\nbreak' }] })).toBe(
            'a\n"line\nbreak"\n'
        );
    });

    it('takes an array of arrays with a header row', () => {
        expect(
            json_to_csv([
                ['a', 'b'],
                [1, '"q"']
            ])
        ).toBe('a,b\n1,"""q"""\n');
    });

    it('refuses what has no rows', () => {
        refused(() => json_to_csv([]), /no rows/);
        refused(() => json_to_csv({ a: 1 }), /array of objects/);
        refused(() => json_to_csv({ a: [], b: [] }), /array of objects/);
        refused(() => json_to_csv([1, 2]), /all be objects/);
        refused(() => json_to_csv([{}]), /no fields/);
    });
});

describe('body_to_csv', () => {
    const URL_CSV = 'https://example.com/a.csv';

    it('passes CSV through, without a BOM and with a final newline', () => {
        const bom = String.fromCharCode(0xfeff);
        expect(body_to_csv('text/csv', URL_CSV, `${bom}a,b\r\n1,2`)).toBe('a,b\r\n1,2\n');
    });

    it('converts JSON by content type, extension or first character', () => {
        expect(body_to_csv('application/json', URL_CSV, '[{"a":1}]')).toBe('a\n1\n');
        expect(body_to_csv('text/plain', 'https://e.com/x.json', '{"rows":[{"a":1}]}')).toBe(
            'a\n1\n'
        );
        expect(body_to_csv(undefined, 'https://e.com/x', ' [{"a":1}]')).toBe('a\n1\n');
        refused(() => body_to_csv('application/json', URL_CSV, '[{'), /does not parse/);
    });

    it('refuses an HTML page (a sheet that is not shared) and an empty body', () => {
        refused(() => body_to_csv('text/html; charset=utf-8', URL_CSV, 'a,b'), /web page/);
        refused(() => body_to_csv('text/plain', URL_CSV, '<!DOCTYPE html><html>'), /web page/);
        refused(() => body_to_csv('text/csv', URL_CSV, '  \n'), /no data/);
    });
});
