// Import a table from a URL (#144): a public Google Sheet link or any URL that answers CSV or
// JSON. Pure rules only (no I/O): which URLs are allowed, how a Google Sheet link becomes its
// CSV export, which addresses are private, how JSON becomes CSV and how a sync is configured.
// url-fetch.ts does the fetching; url-import.manager.ts stores each table's source.
import { BlockList, isIP } from 'net';

export const URL_IMPORT_LIMITS = {
    // Largest body the server will download, in bytes
    max_bytes: 10 * 1024 * 1024,
    // The whole fetch (every redirect, the full body) must finish within this
    timeout_ms: 30 * 1000,
    max_redirects: 5,
    max_url_length: 2048
};

export const SYNC_MODES = ['replace', 'upsert'] as const;
export type SyncMode = (typeof SYNC_MODES)[number];

export const SYNC_SCHEDULES = ['off', 'hourly', 'daily'] as const;
export type SyncSchedule = (typeof SYNC_SCHEDULES)[number];

const SCHEDULE_MS: { [s in SyncSchedule]: number | null } = {
    off: null,
    hourly: 60 * 60 * 1000,
    daily: 24 * 60 * 60 * 1000
};

export type SourceKind = 'google_sheet' | 'url';

export interface SourceUrl {
    // What the user gave (trimmed), shown back to them
    url: string;
    // What the server fetches: for a Google Sheet, its CSV export
    fetch_url: string;
    kind: SourceKind;
}

export interface SyncSettings {
    mode: SyncMode;
    key_column: string | null;
    schedule: SyncSchedule;
}

// A refusal the user can act on; the HTTP layer answers it with a 400
export class UrlImportError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'UrlImportError';
    }
}

const fail = (message: string): never => {
    throw new UrlImportError(message);
};

/** Turns a Google Sheets link into its CSV export URL, or answers null if it isn't one. */
export function google_sheet_csv_url(url: URL): string | null {
    if (url.hostname !== 'docs.google.com') return null;
    const path = url.pathname;
    const hash_gid = /(?:^|[#&])gid=(\d+)/.exec(url.hash.replace(/^#/, ''));
    const gid = url.searchParams.get('gid') || (hash_gid && hash_gid[1]);
    const gid_param = gid && /^\d+$/.test(gid) ? `&gid=${gid}` : '';

    // Published to the web: /spreadsheets/d/e/<id>/pubhtml, /pub?output=...
    const published = /^\/spreadsheets\/d\/e\/([A-Za-z0-9_-]+)(?:\/|$)/.exec(path);
    if (published) {
        const single = url.searchParams.get('single') === 'true' ? '&single=true' : '';
        return `https://docs.google.com/spreadsheets/d/e/${published[1]}/pub?output=csv${gid_param}${single}`;
    }

    // Shared with "Anyone with the link": /spreadsheets/d/<id>/edit, /view, /export...
    const shared = /^\/spreadsheets\/d\/([A-Za-z0-9_-]+)(?:\/|$)/.exec(path);
    if (shared) {
        return `https://docs.google.com/spreadsheets/d/${shared[1]}/export?format=csv${gid_param}`;
    }
    return null;
}

/**
 * Checks a URL the user gave and works out what to fetch. Only http(s) on the default ports,
 * no user name or password, and no host that is an internal name or a private address
 * (assert_public_address checks every address the host resolves to, when it's fetched).
 */
export function parse_source_url(input: unknown): SourceUrl {
    if (typeof input !== 'string' || input.trim() === '') fail('A URL is required');
    const text = (input as string).trim();
    if (text.length > URL_IMPORT_LIMITS.max_url_length) {
        fail(`The URL can't be longer than ${URL_IMPORT_LIMITS.max_url_length} characters`);
    }
    let url: URL;
    try {
        url = new URL(text);
    } catch {
        fail('That is not a valid URL');
    }
    assert_fetchable_url(url);
    const sheet = google_sheet_csv_url(url);
    if (sheet) return { url: text, fetch_url: sheet, kind: 'google_sheet' };
    url.hash = '';
    return { url: text, fetch_url: url.toString(), kind: 'url' };
}

/** The rules every URL fetched must meet, including each redirect's target. */
export function assert_fetchable_url(url: URL, extra_ports: string[] = []) {
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        fail('Only http and https URLs can be imported');
    }
    if (url.username || url.password) fail("The URL can't contain a user name or password");
    // url.port is '' for the scheme's default port (80 for http, 443 for https)
    if (!['', '80', '443', ...extra_ports].includes(url.port)) {
        fail('Only URLs on the standard ports (80 and 443) can be imported');
    }
    // A trailing dot ("localhost.") is the same name
    const host = url.hostname
        .replace(/^\[|\]$/g, '')
        .replace(/\.+$/, '')
        .toLowerCase();
    if (!host) fail('The URL has no host');
    if (isIP(host)) {
        assert_public_address(host);
        return;
    }
    if (!host.includes('.') || INTERNAL_SUFFIXES.some(s => host === s || host.endsWith(`.${s}`))) {
        fail('URLs on private or internal addresses are refused');
    }
}

// Names that only mean something inside a network
const INTERNAL_SUFFIXES = ['localhost', 'local', 'internal', 'intranet', 'lan', 'home.arpa'];

const PRIVATE_V4: [string, number][] = [
    ['0.0.0.0', 8], // "this network"
    ['10.0.0.0', 8],
    ['100.64.0.0', 10], // carrier-grade NAT
    ['127.0.0.0', 8], // loopback
    ['169.254.0.0', 16], // link-local, cloud metadata (169.254.169.254)
    ['172.16.0.0', 12],
    ['192.0.0.0', 24],
    ['192.0.2.0', 24], // documentation
    ['192.88.99.0', 24], // 6to4 relay
    ['192.168.0.0', 16],
    ['198.18.0.0', 15], // benchmarking
    ['198.51.100.0', 24],
    ['203.0.113.0', 24],
    ['224.0.0.0', 4], // multicast
    ['240.0.0.0', 4] // reserved, broadcast
];

const PRIVATE_V6: [string, number][] = [
    ['::', 128], // unspecified
    ['::1', 128], // loopback
    ['100::', 64], // discard
    ['2001::', 23], // IETF protocol assignments (Teredo, ORCHID...)
    ['2001:db8::', 32], // documentation
    ['fc00::', 7], // unique local
    ['fe80::', 10], // link-local
    ['fec0::', 10], // site-local (deprecated)
    ['ff00::', 8] // multicast
];

const private_v4 = new BlockList();
PRIVATE_V4.forEach(([net, prefix]) => private_v4.addSubnet(net, prefix, 'ipv4'));
const private_v6 = new BlockList();
PRIVATE_V6.forEach(([net, prefix]) => private_v6.addSubnet(net, prefix, 'ipv6'));

// Expands an IPv6 address to its 8 groups (numbers), or null if it doesn't parse
function ipv6_groups(address: string): number[] | null {
    let text = address.toLowerCase();
    const zone = text.indexOf('%');
    if (zone !== -1) text = text.slice(0, zone);
    // A trailing dotted IPv4 (::ffff:1.2.3.4) becomes two groups
    const v4 = /(\d+\.\d+\.\d+\.\d+)$/.exec(text);
    if (v4) {
        const parts = v4[1].split('.').map(Number);
        if (parts.some(p => p > 255)) return null;
        text =
            text.slice(0, -v4[1].length) +
            ((parts[0] << 8) | parts[1]).toString(16) +
            ':' +
            ((parts[2] << 8) | parts[3]).toString(16);
    }
    const halves = text.split('::');
    if (halves.length > 2) return null;
    const head = halves[0] ? halves[0].split(':') : [];
    const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
    const missing = 8 - head.length - tail.length;
    if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
    const groups = [...head, ...Array(halves.length === 2 ? missing : 0).fill('0'), ...tail];
    const nums = groups.map(g => (/^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : NaN));
    return nums.some(isNaN) ? null : nums;
}

const v4_of = (hi: number, lo: number) => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;

/** True for any address a server mustn't be made to call: loopback, private, link-local... */
export function is_private_address(address: string): boolean {
    const family = isIP(address);
    if (family === 4) return private_v4.check(address, 'ipv4');
    if (family !== 6) return true; // not an address: refuse
    const g = ipv6_groups(address);
    if (!g) return true;
    const zero = (from: number, to: number) => g.slice(from, to).every(n => n === 0);
    // IPv4-mapped (::ffff:a.b.c.d), IPv4-compatible (::a.b.c.d) and IPv4-translated
    // (::ffff:0:a.b.c.d) addresses reach the IPv4 address inside them
    if (zero(0, 5) && (g[5] === 0xffff || g[5] === 0)) {
        if (g[5] === 0 && g[6] === 0) return true; // ::, ::1 and the rest of ::/96
        return is_private_address(v4_of(g[6], g[7]));
    }
    if (zero(0, 4) && g[4] === 0xffff && g[5] === 0) return is_private_address(v4_of(g[6], g[7]));
    // NAT64 (64:ff9b::a.b.c.d) and 6to4 (2002:aabb:ccdd::) embed an IPv4 address too
    if (g[0] === 0x64 && g[1] === 0xff9b) return is_private_address(v4_of(g[6], g[7]));
    if (g[0] === 0x2002) return is_private_address(v4_of(g[1], g[2]));
    const normal = g.map(n => n.toString(16)).join(':');
    return private_v6.check(normal, 'ipv6');
}

export function assert_public_address(address: string) {
    if (is_private_address(address)) fail('URLs on private or internal addresses are refused');
}

/** Sync settings from a request body, on top of the current ones (for an update). */
export function parse_sync_settings(body: any, current?: SyncSettings): SyncSettings {
    const b = body && typeof body === 'object' ? body : {};
    const mode = b.mode === undefined ? (current ? current.mode : 'replace') : b.mode;
    if (!SYNC_MODES.includes(mode)) fail(`mode must be one of: ${SYNC_MODES.join(', ')}`);
    const schedule = b.schedule === undefined ? (current ? current.schedule : 'off') : b.schedule;
    if (!SYNC_SCHEDULES.includes(schedule)) {
        fail(`schedule must be one of: ${SYNC_SCHEDULES.join(', ')}`);
    }
    let key_column =
        b.key_column === undefined ? (current ? current.key_column : null) : b.key_column;
    if (key_column !== null && typeof key_column !== 'string') fail('key_column must be a string');
    key_column = key_column && key_column.trim() ? key_column.trim() : null;
    if (mode === 'upsert' && !key_column) fail('An upsert needs a key_column');
    if (mode === 'replace') key_column = null;
    return { mode, key_column, schedule };
}

/** When a source on this schedule is next due, or null if it isn't scheduled. */
export function next_sync_at(schedule: SyncSchedule, from: number): number | null {
    const ms = SCHEDULE_MS[schedule];
    return ms === null || ms === undefined ? null : from + ms;
}

// Where the rows are in a JSON body: the body itself, or one of these properties
const ROW_PROPERTIES = ['data', 'rows', 'items', 'records', 'results', 'values'];

function find_rows(value: any): any[] {
    if (Array.isArray(value)) return value;
    if (value && typeof value === 'object') {
        for (const key of ROW_PROPERTIES) {
            if (Array.isArray(value[key])) return value[key];
        }
        const arrays = Object.keys(value).filter(k => Array.isArray(value[k]));
        if (arrays.length === 1) return value[arrays[0]];
    }
    return fail(
        'The JSON must be an array of objects, or an object with one array of them (such as "data" or "rows")'
    );
}

function csv_cell(value: any): string {
    let text: string;
    if (value === null || value === undefined) text = '';
    else if (typeof value === 'object') text = JSON.stringify(value);
    else text = String(value);
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * Turns a JSON body into CSV with a header line: an array of objects (columns are every key,
 * in the order first seen), or an array of arrays whose first row is the header. Nested
 * values are kept as JSON text.
 */
export function json_to_csv(value: any): string {
    const rows = find_rows(value);
    if (rows.length === 0) fail('The JSON has no rows');
    let header: string[];
    let lines: any[][];
    if (rows.every(r => Array.isArray(r))) {
        header = rows[0].map(h => (h === null || h === undefined ? '' : String(h)));
        lines = rows.slice(1);
    } else if (rows.every(r => r && typeof r === 'object' && !Array.isArray(r))) {
        const keys = new Set<string>();
        rows.forEach(r => Object.keys(r).forEach(k => keys.add(k)));
        header = [...keys];
        lines = rows.map(r => header.map(k => r[k]));
    } else {
        return fail('The JSON rows must all be objects (or all arrays)');
    }
    if (header.length === 0) fail('The JSON rows have no fields');
    return [header, ...lines].map(cells => cells.map(csv_cell).join(',')).join('\n') + '\n';
}

/** Whether a body is JSON, from its content type, its URL or its first character. */
export function looks_like_json(content_type: string | undefined, url: string, body: string) {
    const type = (content_type || '').toLowerCase();
    if (type.includes('json')) return true;
    if (type.includes('csv')) return false;
    if (/\.json$/i.test(new URL(url).pathname)) return true;
    return /^\s*[[{]/.test(body);
}

/**
 * Turns a fetched body into the CSV the processor reads: JSON is converted, a UTF-8 byte order
 * mark is dropped and the last line gets its newline. An HTML page (a Google sign-in page, for
 * a sheet that isn't shared) is refused.
 */
export function body_to_csv(content_type: string | undefined, url: string, body: string): string {
    let text = body.charCodeAt(0) === 0xfeff ? body.slice(1) : body;
    const type = (content_type || '').toLowerCase();
    if (type.includes('text/html') || /^\s*<(!doctype|html)/i.test(text)) {
        fail(
            'The URL answered with a web page, not CSV or JSON. For a Google Sheet, share it with "Anyone with the link" or publish it to the web.'
        );
    }
    if (looks_like_json(content_type, url, text)) {
        let parsed;
        try {
            parsed = JSON.parse(text);
        } catch {
            fail('The URL answered with JSON that does not parse');
        }
        return json_to_csv(parsed);
    }
    if (text.trim() === '') fail('The URL answered with no data');
    if (!text.endsWith('\n')) text += '\n';
    return text;
}
