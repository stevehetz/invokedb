// Data export of a whole account (#215): the pure rules. The processor writes one zip with every
// table as CSV and as JSON (columns with their types, then the rows), and the account's
// views and webhooks as JSON, never their secrets (no webhook signing secret, no API key).
import { randomUUID } from 'crypto';
import { parse_utc_date } from '../date';
import { LINK_TYPE } from '../web-file/link';

export const EXPORT_LIMITS = {
    // How long the download link works
    keep_ms: 24 * 60 * 60 * 1000,
    // Exports an account may ask for in `per_ms`
    max_per_window: 5,
    per_ms: 24 * 60 * 60 * 1000,
    // Rows read from Mongo at a time, and the size of the chunks handed to the zip
    batch_size: 500,
    chunk_bytes: 64 * 1024,
    // Longest file or folder name in the zip, in characters
    max_name_length: 100,
    // Records (not files) are dropped this long after they're made
    keep_record_days: 30
};

export const EXPORT_JOB_EVENT = 'ACCOUNT_EXPORT';

// The version of the zip's layout, in manifest.json
export const EXPORT_FORMAT_VERSION = 1;

export type ExportStatus = 'pending' | 'running' | 'ready' | 'error' | 'expired';

export interface AccountExport {
    id: string;
    account_id: number;
    status: ExportStatus;
    created_at: number;
    // A Date, for the TTL index that drops old records
    created_date: Date;
    started_at: number | null;
    finished_at: number | null;
    // When the download link stops working (set when it's ready)
    expires_at: number | null;
    size: number | null;
    tables: number | null;
    rows: number | null;
    error: string | null;
}

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function new_export_id() {
    return randomUUID();
}

export function is_export_id(id: unknown): id is string {
    return typeof id === 'string' && ID.test(id);
}

/** The zip's file name on the file share (the id is checked, so it can't leave the folder). */
export function export_file_name(id: string) {
    if (!is_export_id(id)) throw new Error('Not an export id');
    return `${id}.zip`;
}

/** The name the browser saves it as. */
export function download_name(created_at: number) {
    const day = new Date(created_at).toISOString().slice(0, 10);
    return `invokedb-export-${day}.zip`;
}

/** A new export record. */
export function new_export(account_id: number, now: number): AccountExport {
    return {
        id: new_export_id(),
        account_id,
        status: 'pending',
        created_at: now,
        created_date: new Date(now),
        started_at: null,
        finished_at: null,
        expires_at: null,
        size: null,
        tables: null,
        rows: null,
        error: null
    };
}

export function is_active(e: AccountExport | null) {
    return !!e && (e.status === 'pending' || e.status === 'running');
}

/** A ready export whose link still works. */
export function is_downloadable(e: AccountExport | null, now: number) {
    return !!e && e.status === 'ready' && !!e.expires_at && e.expires_at > now;
}

/** What the app sees of an export. */
export function export_view(e: AccountExport | null, now: number) {
    if (!e) return null;
    const expired = e.status === 'ready' && !is_downloadable(e, now);
    return {
        id: e.id,
        status: expired ? 'expired' : e.status,
        created_at: e.created_at,
        finished_at: e.finished_at,
        expires_at: e.expires_at,
        size: e.size,
        tables: e.tables,
        rows: e.rows,
        error: e.error
    };
}

// Characters that aren't safe in a file name on some system, and control characters
const UNSAFE = /[\u0000-\u001f\u007f<>:"/\\|?*]/g;

/** A table or folder name made safe for a path in the zip. */
export function safe_name(name: unknown) {
    let s = typeof name === 'string' ? name.replace(UNSAFE, '_').trim() : '';
    s = s.replace(/^\.+/, '_').slice(0, EXPORT_LIMITS.max_name_length).trim();
    return s || 'untitled';
}

export interface ExportDirEntry {
    id: number;
    name: string;
    type: string; // 'file' (a table) or 'dir' (a folder)
    parent_id: number | null;
}

export interface ExportTablePath {
    id: number;
    name: string;
    // The folders it's in, top first
    folders: string[];
    // The path in the zip without the extension, e.g. `tables/Sales/Orders`
    path: string;
}

/**
 * Where each table goes in the zip: `tables/<folders>/<name>`, folders and names made safe, and
 * names that would clash (two tables, or two folders, ignoring case) numbered: `Orders (2)`.
 */
export function table_paths(entries: ExportDirEntry[]): ExportTablePath[] {
    const by_id = new Map(entries.map(e => [e.id, e]));
    const folder_names = (e: ExportDirEntry) => {
        const names: string[] = [];
        const seen = new Set<number>();
        let parent = e.parent_id === null || e.parent_id === undefined ? null : e.parent_id;
        while (parent !== null && !seen.has(parent)) {
            seen.add(parent);
            const dir = by_id.get(parent);
            if (!dir || dir.type !== 'dir') break;
            names.unshift(dir.name);
            parent = dir.parent_id === null || dir.parent_id === undefined ? null : dir.parent_id;
        }
        return names;
    };

    const used = new Set<string>();
    const unique = (base: string) => {
        let candidate = base;
        for (let n = 2; used.has(candidate.toLowerCase()); n++) candidate = `${base} (${n})`;
        used.add(candidate.toLowerCase());
        return candidate;
    };

    return entries
        .filter(e => e.type === 'file')
        .sort((a, b) => a.id - b.id)
        .map(e => {
            const folders = folder_names(e);
            const dir = ['tables', ...folders.map(safe_name)].join('/');
            const path = unique(`${dir}/${safe_name(e.name)}`);
            return { id: e.id, name: e.name, folders, path };
        });
}

export interface ExportColumn {
    name: string;
    type: string;
    // A link column (#147): the linked table's id and its name, when it's still there
    link_table_id?: number | null;
    link_table?: string | null;
    // The stored field the rows use; not written to the zip
    field: string;
}

/** A table's columns as exported: named ones only, in the grid's order. */
export function export_columns(cols: any[], table_names: Map<number, string>): ExportColumn[] {
    return (cols || [])
        .filter(c => c && !c.deleted && typeof c.headerName === 'string' && c.headerName !== '')
        .sort((a, b) => (a.order ?? a.col_index ?? 0) - (b.order ?? b.col_index ?? 0))
        .map(c => {
            const type = c.col_type || 'string';
            const col: ExportColumn = { name: c.headerName, type, field: c.field };
            if (type === LINK_TYPE) {
                const id = Number(c.link_table_id);
                col.link_table_id = Number.isInteger(id) ? id : null;
                col.link_table = table_names.get(id) ?? null;
            }
            return col;
        });
}

/** The schema written to the zip (without the stored field names). */
export function column_schema(columns: ExportColumn[]) {
    return columns.map(({ field: _f, ...rest }) => rest);
}

/** A stored value as exported: dates as ISO strings, links as arrays of row ids. */
export function export_value(value: unknown, type: string): string | number | string[] | null {
    if (value === undefined || value === null) return null;
    if (type === 'date') {
        const d = parse_utc_date(value);
        return isNaN(d.getTime()) ? String(value) : d.toISOString();
    }
    if (type === LINK_TYPE) {
        return Array.isArray(value) ? value.map(v => String(v)) : null;
    }
    if (type === 'number') {
        return typeof value === 'number' && Number.isFinite(value) ? value : String(value);
    }
    return typeof value === 'string' ? value : String(value);
}

/** A row by column name, with its id first. */
export function export_row(row: any, columns: ExportColumn[]) {
    const out: Record<string, unknown> = { _id: row && row._id ? String(row._id) : null };
    columns.forEach(c => (out[c.name] = export_value(row ? row[c.field] : null, c.type)));
    return out;
}

/** One CSV cell (RFC 4180): quoted when it needs to be; a link's ids are joined with spaces. */
export function csv_cell(value: unknown) {
    if (value === null || value === undefined) return '';
    const s = Array.isArray(value) ? value.join(' ') : String(value);
    return /[",\r\n]/.test(s) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function csv_line(values: unknown[]) {
    return values.map(csv_cell).join(',') + '\r\n';
}

/** Joins small strings into chunks of about `size` characters. */
async function* chunked(parts: AsyncIterable<string>, size = EXPORT_LIMITS.chunk_bytes) {
    let buf = '';
    for await (const part of parts) {
        buf += part;
        if (buf.length >= size) {
            yield buf;
            buf = '';
        }
    }
    if (buf) yield buf;
}

/** A table as CSV: a header of column names (and `_id` first), then a line per row. */
export function csv_chunks(columns: ExportColumn[], rows: AsyncIterable<any>) {
    async function* lines() {
        yield csv_line(['_id', ...columns.map(c => c.name)]);
        for await (const row of rows) {
            const r = export_row(row, columns);
            yield csv_line([r._id, ...columns.map(c => r[c.name])]);
        }
    }
    return chunked(lines());
}

/** A table as JSON: `{ id, name, folders, columns, rows: [...] }`, a row per line. */
export function json_chunks(
    table: { id: number; name: string; folders: string[] },
    columns: ExportColumn[],
    rows: AsyncIterable<any>
) {
    async function* parts() {
        const head = JSON.stringify({
            id: table.id,
            name: table.name,
            folders: table.folders,
            columns: column_schema(columns)
        });
        // Everything but the closing brace, then the rows
        yield `${head.slice(0, -1)},"rows":[`;
        let first = true;
        for await (const row of rows) {
            yield `${first ? '\n' : ',\n'}${JSON.stringify(export_row(row, columns))}`;
            first = false;
        }
        yield first ? ']}\n' : '\n]}\n';
    }
    return chunked(parts());
}

/** Drops the account id (and any `_id`) from a stored setting. */
function without_owner<T extends Record<string, any>>(doc: T) {
    const { account_id: _a, _id: _i, ...rest } = doc;
    return rest;
}

/** A webhook's settings without its signing secret or delivery state. */
export function webhook_settings(hook: any, table_names: Map<number, string>) {
    const {
        secret: _s,
        last_delivery_at: _d,
        last_delivery_status: _st,
        ...rest
    } = without_owner(hook);
    return {
        ...rest,
        table:
            hook.file_id === null || hook.file_id === undefined
                ? null
                : (table_names.get(hook.file_id) ?? null)
    };
}

export function view_settings(view: any, table_names: Map<number, string>) {
    return { ...without_owner(view), table: table_names.get(view.file_id) ?? null };
}

/** manifest.json: what's in the zip. */
export function manifest(
    exported_at: number,
    tables: Array<ExportTablePath & { rows: number; columns: number }>
) {
    return {
        format_version: EXPORT_FORMAT_VERSION,
        exported_at: new Date(exported_at).toISOString(),
        tables: tables.map(t => ({
            id: t.id,
            name: t.name,
            folders: t.folders,
            columns: t.columns,
            rows: t.rows,
            csv: `${t.path}.csv`,
            json: `${t.path}.json`
        })),
        files: {
            views: 'views.json',
            webhooks: 'webhooks.json'
        },
        notes: [
            'Each table is in CSV and in JSON. Dates are ISO 8601 in UTC; a link column holds the ids (_id) of rows of the linked table, separated by spaces in the CSV.',
            'Webhook signing secrets and API keys are not included.'
        ]
    };
}
