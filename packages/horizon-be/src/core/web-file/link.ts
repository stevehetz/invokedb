import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Link columns (#147): a column of type `link` holds references to rows of another table of
 * the same account. Its definition names the table (`link_table_id`, a file_directory id) and
 * the column shown for a linked row (`link_display_field`, a column field of that table). A
 * cell is stored as an array of row ids (24-hex strings), or null when it links to nothing.
 * Rows live in the account's own Mongo database, so a link can't reach another account's rows;
 * the column's table is checked to be the account's when the column is saved.
 */

export const LINK_TYPE = 'link';

/** How many rows one cell can link to (the ids also have to fit the 2000-character limit). */
export const MAX_LINKS_PER_CELL = 50;

/** How many rows the grid's picker offers at a time. */
export const LINK_OPTIONS_LIMIT = 20;

const ROW_ID = /^[0-9a-f]{24}$/i;

function bad_request(message: string): never {
    throw new HttpException(message, HttpStatus.BAD_REQUEST);
}

export function is_link_column(col: any): boolean {
    return !!col && col.col_type === LINK_TYPE;
}

export function is_row_id(value: unknown): value is string {
    return typeof value === 'string' && ROW_ID.test(value);
}

/**
 * A link cell as written by the grid or the API, as stored: null for nothing, else unique
 * lowercase row ids in the order given. Takes an id, an array of ids, a comma-separated
 * string of ids, or the expanded form (`{ _id }` objects), so a row read with `expand` can be
 * written back. Anything else is a 400.
 */
export function normalize_link_value(value: unknown, column_name = 'link'): string[] | null {
    if (value === undefined || value === null) return null;
    let items: unknown[];
    if (Array.isArray(value)) items = value;
    else if (typeof value === 'string') items = value.split(',');
    else if (typeof value === 'object') items = [value];
    else bad_request(`${column_name} must be a row _id or an array of row _ids`);

    const ids: string[] = [];
    for (let item of items) {
        if (item && typeof item === 'object' && !Array.isArray(item)) {
            item = (item as any)._id ?? {};
        }
        if (typeof item === 'string') item = item.trim();
        if (item === '' || item === null || item === undefined) continue;
        if (!is_row_id(item)) {
            bad_request(`${column_name}: ${JSON.stringify(item)} is not a row _id`);
        }
        const id = (item as string).toLowerCase();
        if (!ids.includes(id)) ids.push(id);
    }
    if (ids.length > MAX_LINKS_PER_CELL) {
        bad_request(`${column_name} can link to at most ${MAX_LINKS_PER_CELL} rows`);
    }
    return ids.length > 0 ? ids : null;
}

/**
 * A stored value read back as a link cell, without throwing: what a column holds when its
 * type changes to link (ids are kept, anything else dropped).
 */
export function coerce_link_value(value: unknown): string[] | null {
    const items = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : [];
    const ids = [];
    for (const item of items) {
        const id = typeof item === 'string' ? item.trim().toLowerCase() : '';
        if (is_row_id(id) && !ids.includes(id)) ids.push(id);
    }
    return ids.length > 0 ? ids.slice(0, MAX_LINKS_PER_CELL) : null;
}

/** The link settings of a column update: a table id (a positive integer) and a field. */
export function assert_link_settings(col: any): { table_id: number; display_field: string } {
    const table_id = Number(col.link_table_id);
    if (
        col.link_table_id === undefined ||
        col.link_table_id === null ||
        col.link_table_id === '' ||
        !Number.isInteger(table_id) ||
        table_id <= 0
    ) {
        bad_request('A link column needs link_table_id: the id of the table it links to');
    }
    const display_field = col.link_display_field;
    if (
        display_field !== undefined &&
        display_field !== null &&
        (typeof display_field !== 'string' || display_field.startsWith('$'))
    ) {
        bad_request('link_display_field must be a column field');
    }
    return { table_id, display_field: display_field || '' };
}

/**
 * The `expand` query parameter of /api/v1 (comma-separated column names, as the response
 * names them): the link columns to expand. An unknown or non-link column is a 400.
 */
export function parse_expand<T extends { name: string; col: any }>(
    expand: unknown,
    columns: T[]
): T[] {
    if (expand === undefined || expand === null || expand === '') return [];
    const raw = Array.isArray(expand) ? expand : [expand];
    if (!raw.every(e => typeof e === 'string')) bad_request('expand must be column names');
    const names = raw
        .flatMap(e => (e as string).split(','))
        .map(n => n.trim())
        .filter(n => n !== '');
    const out: T[] = [];
    for (const name of names) {
        const column = columns.find(c => c.name === name);
        if (!column) bad_request(`expand: ${name} is not a column`);
        if (!is_link_column(column.col)) bad_request(`expand: ${name} is not a link column`);
        if (!out.includes(column)) out.push(column);
    }
    return out;
}

/** Every row id in these cells, once. */
export function collect_link_ids(values: unknown[]): string[] {
    const ids = new Set<string>();
    values.forEach(v => (Array.isArray(v) ? v : []).forEach(id => is_row_id(id) && ids.add(id)));
    return [...ids];
}

/** The ids in `ids` that aren't in `existing`. */
export function missing_link_ids(ids: string[], existing: string[]): string[] {
    const found = new Set(existing.map(id => id.toLowerCase()));
    return ids.filter(id => !found.has(id));
}

/**
 * The ids of a link cell about to be written that aren't already stored in it, so only those
 * need checking: an id that's in the cell already (even one whose row is gone) doesn't stop
 * the rest of the row from being saved.
 */
export function new_link_ids(ids: string[] | null, stored: unknown): string[] {
    const kept = new Set(collect_link_ids([stored]).map(id => id.toLowerCase()));
    return (ids || []).filter(id => !kept.has(id));
}

/**
 * The column of the linked table that labels its rows: the one the link column names, if it
 * still exists, else the table's first column.
 */
export function link_display_column(target_columns: any[], display_field: string) {
    const live = (target_columns || []).filter(c => c && !c.deleted);
    return live.find(c => c.field === display_field) || live[0] || null;
}

/** What the grid shows for a linked row: its display column's value, or its id. */
export function link_label(row: any, display_field: string | null): string {
    const value = display_field && row ? row[display_field] : undefined;
    if (value === undefined || value === null || value === '') return String(row && row._id);
    return String(value);
}

/** A cell's ids replaced by the linked rows, in order; rows that are gone are left out. */
export function expand_link_value(value: unknown, rows_by_id: Map<string, any>): any[] | null {
    if (!Array.isArray(value)) return null;
    return value.filter(id => rows_by_id.has(String(id))).map(id => rows_by_id.get(String(id)));
}
