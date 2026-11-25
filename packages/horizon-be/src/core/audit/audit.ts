// Audit log (#217): who changed what. Pure rules only (no I/O): who the actor of a request is,
// what an entry says about a change, which column changes are worth an entry, paging and how
// long entries are kept. audit.manager.ts stores the entries; AuditService records and lists them.
import { ObjectId } from 'mongodb';

// Kept this long on every tier for now (owner's decision); the processor deletes older entries
export const AUDIT_KEEP_DAYS = 90;
export const AUDIT_PAGE_DEFAULT = 50;
export const AUDIT_PAGE_MAX = 100;
// Row ids kept on one entry; a bigger change keeps the count and the first ids
export const AUDIT_MAX_IDS = 20;
// Column names kept on one row-update entry
export const AUDIT_MAX_FIELDS = 20;

export const AUDIT_ACTIONS = [
    'row.created',
    'row.updated',
    'row.deleted',
    'column.created',
    'column.updated',
    'column.deleted',
    'table.created',
    'table.renamed',
    'table.deleted',
    'api_key.created',
    'api_key.revoked'
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export type AuditSource = 'app' | 'api' | 'form';

// Who made a change: the signed-in user (by email), an API key (by name and prefix, never the
// key), or a visitor through one of the account's forms
export interface AuditActor {
    type: 'user' | 'api_key' | 'form';
    label: string;
    key_id?: number;
    key_prefix?: string;
    form_id?: string;
}

export interface AuditDetails {
    count?: number;
    row_ids?: string[];
    columns?: string[];
    column?: string;
    from?: string | null;
    to?: string | null;
    changes?: string[];
    key_name?: string;
    key_prefix?: string;
}

export interface AuditEntry {
    id: string;
    account_id: number;
    // null for account-wide changes (API keys)
    file_id: number | null;
    // The table's name when the change was made (it may be renamed or deleted since)
    table_name: string | null;
    action: AuditAction;
    actor: AuditActor;
    source: AuditSource;
    summary: string;
    details: AuditDetails;
    created_at: number;
}

// An ObjectId's hex: it starts with the time and counts up, so entries made in the same
// millisecond still page in the order they were made
export function new_audit_id(): string {
    return new ObjectId().toHexString();
}

/**
 * The actor of a request, from the `Account` it acts as: an /api/v1 caller's account carries its
 * key's scope (`key_scope`), the app's doesn't.
 */
export function actor_of(account: any): AuditActor {
    const scope = account && account.key_scope;
    if (scope && scope.key_id) {
        const name = typeof scope.name === 'string' && scope.name ? scope.name : 'API key';
        const prefix = typeof scope.prefix === 'string' ? scope.prefix : '';
        return {
            type: 'api_key',
            label: prefix ? `${name} (${prefix}…)` : name,
            key_id: scope.key_id,
            key_prefix: prefix
        };
    }
    const email = account && typeof account.email === 'string' ? account.email : '';
    return { type: 'user', label: email || 'You' };
}

export function form_actor(form_id: string, form_name?: string): AuditActor {
    return { type: 'form', label: form_name ? `Form "${form_name}"` : 'A form', form_id };
}

export function source_of(actor: AuditActor): AuditSource {
    if (actor.type === 'api_key') return 'api';
    if (actor.type === 'form') return 'form';
    return 'app';
}

function plural(n: number, word: string) {
    return `${n.toLocaleString('en-US')} ${word}${n === 1 ? '' : 's'}`;
}

function quoted(name: unknown) {
    return `"${typeof name === 'string' && name !== '' ? name : '(unnamed)'}"`;
}

/** What a row change entry says: the count, the first ids and (updates) the columns touched. */
export function row_change(
    action: 'row.created' | 'row.updated' | 'row.deleted',
    ids: string[],
    columns: string[] = []
): { summary: string; details: AuditDetails } {
    const count = ids.length;
    const verb = { 'row.created': 'Added', 'row.updated': 'Updated', 'row.deleted': 'Deleted' }[
        action
    ];
    const cols = [...new Set(columns.filter(c => typeof c === 'string' && c !== ''))];
    const details: AuditDetails = { count, row_ids: ids.slice(0, AUDIT_MAX_IDS).map(String) };
    let summary = `${verb} ${plural(count, 'row')}`;
    if (action === 'row.updated' && cols.length > 0) {
        details.columns = cols.slice(0, AUDIT_MAX_FIELDS);
        summary += `: ${details.columns.join(', ')}`;
        if (cols.length > AUDIT_MAX_FIELDS)
            summary += ` and ${cols.length - AUDIT_MAX_FIELDS} more`;
    }
    return { summary, details };
}

/** The column names (headers) of the fields a row update sets. */
export function updated_columns(rows: any[], columns: any[]): string[] {
    const by_field = new Map<string, string>();
    (columns || []).forEach(c => {
        if (c && typeof c.field === 'string') by_field.set(c.field, c.headerName);
    });
    const out = new Set<string>();
    (rows || []).forEach(row => {
        if (!row || typeof row !== 'object') return;
        Object.keys(row).forEach(key => {
            const name = by_field.get(key);
            if (typeof name === 'string' && name !== '') out.add(name);
        });
    });
    return [...out];
}

export interface ColumnChange {
    action: 'column.created' | 'column.updated' | 'column.deleted';
    summary: string;
    details: AuditDetails;
}

function col_type(c: any) {
    return (c && c.col_type) || 'string';
}

function named(c: any) {
    return !!c && typeof c.headerName === 'string' && c.headerName !== '';
}

/**
 * The changes worth an entry when columns are saved: a column named for the first time (the
 * grid's placeholders have no name), renamed, given another type, indexed or not, linked to
 * another table, or deleted. Widths, order and the grid's other settings aren't logged.
 * `before` is the table's columns as they were; `updates` what was saved (each with its `_id`).
 */
export function column_changes(before: any[], updates: any[]): ColumnChange[] {
    const by_id = new Map<string, any>();
    (before || []).forEach(c => c && c._id !== undefined && by_id.set(String(c._id), c));
    const out: ColumnChange[] = [];
    (updates || []).forEach(update => {
        if (!update || typeof update !== 'object') return;
        const old = by_id.get(String(update._id));
        if (!old) return;
        const after = { ...old, ...update };
        if (after.deleted === true && old.deleted !== true) {
            if (named(old)) out.push(column_deleted(old));
            return;
        }
        if (after.deleted === true) return;
        if (!named(old)) {
            if (named(after)) out.push(column_created(after));
            return;
        }
        if (!named(after)) return;
        const changes: string[] = [];
        if (after.headerName !== old.headerName) {
            changes.push(`renamed ${quoted(old.headerName)} to ${quoted(after.headerName)}`);
        }
        if (col_type(after) !== col_type(old)) {
            changes.push(`type ${col_type(old)} → ${col_type(after)}`);
        }
        if (!!after.indexed !== !!old.indexed) {
            changes.push(after.indexed ? 'indexed' : 'not indexed');
        }
        if (
            col_type(after) === 'link' &&
            String(after.link_table_id ?? '') !== String(old.link_table_id ?? '')
        ) {
            changes.push('linked to another table');
        }
        if (changes.length === 0) return;
        out.push({
            action: 'column.updated',
            summary: `Changed column ${quoted(after.headerName)}: ${changes.join(', ')}`,
            details: {
                column: after.headerName,
                from: old.headerName,
                to: after.headerName,
                changes
            }
        });
    });
    return out;
}

export function column_created(col: any): ColumnChange {
    return {
        action: 'column.created',
        summary: `Added column ${quoted(col.headerName)} (${col_type(col)})`,
        details: { column: col.headerName }
    };
}

export function column_deleted(col: any): ColumnChange {
    return {
        action: 'column.deleted',
        summary: `Deleted column ${quoted(col.headerName)}`,
        details: { column: col.headerName }
    };
}

export function table_change(
    action: 'table.created' | 'table.renamed' | 'table.deleted',
    name: string,
    old_name?: string
): { summary: string; details: AuditDetails } {
    if (action === 'table.created')
        return { summary: `Created table ${quoted(name)}`, details: {} };
    if (action === 'table.deleted')
        return { summary: `Deleted table ${quoted(name)}`, details: {} };
    return {
        summary: `Renamed table ${quoted(old_name)} to ${quoted(name)}`,
        details: { from: old_name ?? null, to: name }
    };
}

export function api_key_change(
    action: 'api_key.created' | 'api_key.revoked',
    key: { name: string; prefix: string; access?: string }
): { summary: string; details: AuditDetails } {
    const label = `${quoted(key.name)} (${key.prefix}…)`;
    const summary =
        action === 'api_key.created'
            ? `Created API key ${label}${key.access ? `, ${key.access.replace('_', '/')}` : ''}`
            : `Revoked API key ${label}`;
    return { summary, details: { key_name: key.name, key_prefix: key.prefix } };
}

export interface AuditPage {
    limit: number;
    // Entries older than this one (newest first)
    before: { at: number; id: string } | null;
}

export class AuditPageError extends Error {}

export function encode_audit_cursor(entry: { created_at: number; id: string }) {
    return Buffer.from(`${entry.created_at}:${entry.id}`, 'utf8').toString('base64url');
}

/** `?limit=` (1 to AUDIT_PAGE_MAX) and `?cursor=` (from the last page's `next_cursor`). */
export function parse_audit_page(query: any): AuditPage {
    const q = query && typeof query === 'object' ? query : {};
    let limit = AUDIT_PAGE_DEFAULT;
    if (q.limit !== undefined && q.limit !== '') {
        limit = Number(q.limit);
        if (!Number.isInteger(limit) || limit < 1 || limit > AUDIT_PAGE_MAX) {
            throw new AuditPageError(`limit must be a whole number from 1 to ${AUDIT_PAGE_MAX}`);
        }
    }
    let before = null;
    if (q.cursor !== undefined && q.cursor !== '') {
        const raw =
            typeof q.cursor === 'string' ? Buffer.from(q.cursor, 'base64url').toString('utf8') : '';
        const m = /^(\d{1,16}):([0-9a-f]{24})$/.exec(raw);
        if (!m) throw new AuditPageError('cursor is not valid');
        before = { at: Number(m[1]), id: m[2] };
    }
    return { limit, before };
}

/** Entries made before this are deleted. */
export function audit_cutoff(now: number): number {
    return now - AUDIT_KEEP_DAYS * 24 * 60 * 60 * 1000;
}
