import { HttpException, HttpStatus } from '@nestjs/common';
import { MAX_LINKS_PER_CELL, is_link_column, is_row_id } from './link';

/**
 * Fill a link column by matching (#321): each row of the table whose link cell is empty is
 * linked to every row of the linked table whose `target_field` holds the same value as the
 * row's `source_field`. Strings match trimmed and case-insensitive, numbers by value, dates by
 * the same instant; an empty value never matches. Cells already holding links are left alone.
 * It fills once, when applied; later edits don't match again.
 */

/** How values of the two columns are compared. */
export type MatchKind = 'string' | 'number' | 'date';

/** What matching does to one row. */
export type MatchOutcome = 'linked' | 'no_match' | 'already_linked';

/**
 * The preview's numbers. `linked`: rows that get links (each to all its matches);
 * `multiple`: those of them that match more than one row (counted in `linked` too);
 * `no_match`: empty rows with no match (or an empty value); `already_linked`: rows whose cell
 * already holds links, left alone.
 */
export interface MatchCounts {
    linked: number;
    no_match: number;
    multiple: number;
    already_linked: number;
}

export interface LinkMatchRequest {
    field: string;
    source_field: string;
    target_field: string;
    apply: boolean;
}

function bad_request(message: string): never {
    throw new HttpException(message, HttpStatus.BAD_REQUEST);
}

function col_type(col: any): string {
    return (col && col.col_type) || 'string';
}

/**
 * How two columns' values are compared: as numbers when one is a number column and the other a
 * number or string column, as dates likewise, otherwise as text.
 */
export function match_kind(source_type: string, target_type: string): MatchKind {
    const types = [source_type || 'string', target_type || 'string'];
    const only = (t: string) => types.every(x => x === t || x === 'string');
    if (types.includes('number') && only('number')) return 'number';
    if (types.includes('date') && only('date')) return 'date';
    return 'string';
}

/** The text a stored value compares as. */
function as_text(value: unknown): string | null {
    if (value instanceof Date) {
        return Number.isNaN(value.getTime()) ? null : value.toISOString();
    }
    if (typeof value === 'number') return Number.isFinite(value) ? String(value) : null;
    if (typeof value === 'string' || typeof value === 'boolean') return String(value);
    return null;
}

/**
 * The key a value matches on, or null when it can't match anything (null, empty, or not a
 * value of the kind).
 */
export function match_key(value: unknown, kind: MatchKind): string | null {
    if (value === undefined || value === null) return null;
    if (kind === 'number') {
        let n: number;
        if (typeof value === 'number') n = value;
        else if (typeof value === 'string' && value.trim() !== '') n = Number(value.trim());
        else return null;
        // -0 and 0 are the same value
        return Number.isFinite(n) ? `n:${n === 0 ? 0 : n}` : null;
    }
    if (kind === 'date') {
        let t: number;
        if (value instanceof Date) t = value.getTime();
        else if (typeof value === 'string' && value.trim() !== '') t = Date.parse(value.trim());
        else if (typeof value === 'number') t = value;
        else return null;
        return Number.isFinite(t) ? `d:${t}` : null;
    }
    const text = as_text(value);
    if (text === null) return null;
    const trimmed = text.trim().toLowerCase();
    return trimmed === '' ? null : `s:${trimmed}`;
}

/** Builds the linked table's value → row ids map, one row at a time (rows can be streamed). */
export class MatchIndex {
    private readonly by_key = new Map<string, string[]>();

    constructor(private readonly kind: MatchKind) {}

    add(id: unknown, value: unknown) {
        const row_id = String(id ?? '').toLowerCase();
        if (!is_row_id(row_id)) return;
        const key = match_key(value, this.kind);
        if (key === null) return;
        const ids = this.by_key.get(key);
        if (!ids) this.by_key.set(key, [row_id]);
        else if (!ids.includes(row_id)) ids.push(row_id);
    }

    /** The ids of the rows holding this value (at most a cell's worth), in the order added. */
    find(value: unknown): string[] {
        const key = match_key(value, this.kind);
        if (key === null) return [];
        return (this.by_key.get(key) || []).slice(0, MAX_LINKS_PER_CELL);
    }

    /** How many rows hold this value, past the cell's limit too. */
    count(value: unknown): number {
        const key = match_key(value, this.kind);
        return key === null ? 0 : (this.by_key.get(key) || []).length;
    }
}

/** A link cell counts as empty when it's null, missing or an empty array. */
export function is_empty_link_cell(cell: unknown): boolean {
    if (cell === undefined || cell === null || cell === '') return true;
    return Array.isArray(cell) && cell.length === 0;
}

/**
 * What matching does to one row: its cell, its source value and the index. `ids` are the rows
 * it gets linked to (only for `linked`); `multiple` when it matches more than one.
 */
export function match_row(
    cell: unknown,
    value: unknown,
    index: MatchIndex
): { outcome: MatchOutcome; ids: string[]; multiple: boolean } {
    if (!is_empty_link_cell(cell)) return { outcome: 'already_linked', ids: [], multiple: false };
    const ids = index.find(value);
    if (ids.length === 0) return { outcome: 'no_match', ids: [], multiple: false };
    return { outcome: 'linked', ids, multiple: index.count(value) > 1 };
}

export function empty_counts(): MatchCounts {
    return { linked: 0, no_match: 0, multiple: 0, already_linked: 0 };
}

export function add_to_counts(counts: MatchCounts, result: ReturnType<typeof match_row>) {
    counts[result.outcome] += 1;
    if (result.multiple) counts.multiple += 1;
    return counts;
}

/** The request body: three column fields and `apply`. A 400 otherwise. */
export function parse_link_match_body(body: any): LinkMatchRequest {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        bad_request('The body must be { field, source_field, target_field, apply }');
    }
    const fields = ['field', 'source_field', 'target_field'];
    for (const name of fields) {
        const value = body[name];
        if (typeof value !== 'string' || value === '' || value.startsWith('$')) {
            bad_request(`${name} must be a column field`);
        }
    }
    if (body.apply !== undefined && typeof body.apply !== 'boolean') {
        bad_request('apply must be true or false');
    }
    return {
        field: body.field,
        source_field: body.source_field,
        target_field: body.target_field,
        apply: body.apply === true
    };
}

/**
 * This table's columns of a request, checked: `field` a link column (with a table to link to)
 * and `source_field` a column that isn't a link column. A 400 otherwise.
 */
export function assert_source_columns(req: LinkMatchRequest, columns: any[]) {
    const live = (columns || []).filter(c => c && !c.deleted);
    const link = live.find(c => c.field === req.field);
    if (!link || !is_link_column(link)) bad_request(`${req.field} is not a link column`);
    if (!link.link_table_id) bad_request(`${req.field} doesn't link to a table`);
    const source = live.find(c => c.field === req.source_field);
    if (!source) bad_request(`${req.source_field} is not a column of this table`);
    if (is_link_column(source)) bad_request('The column to match on cannot be a link column');
    return { link, source };
}

/** The linked table's column of a request: there, and not a link column. A 400 otherwise. */
export function assert_target_column(req: LinkMatchRequest, target_columns: any[]) {
    const target = (target_columns || []).find(
        c => c && !c.deleted && c.field === req.target_field
    );
    if (!target) bad_request(`${req.target_field} is not a column of the linked table`);
    if (is_link_column(target)) bad_request('The column to match on cannot be a link column');
    return target;
}

/** How a request's two columns compare. */
export function columns_match_kind(source: any, target: any): MatchKind {
    return match_kind(col_type(source), col_type(target));
}
