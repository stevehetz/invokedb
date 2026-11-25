// Richer /api/v1 queries (#141): POST /api/v1/query and /api/v1/count. Turns a JSON body
// (filters, sort, fields, limit, cursor) into a MongoDB find, after checking every column name,
// operator and value against the table's columns. Pure functions, unit-tested in
// row-query.spec.ts; the manager runs the result (WebFileManager.query_rows).
//
// Nothing from the body reaches Mongo as a key or an operator: field names come from the
// table's column definitions, operators from the fixed list below, and values are checked to be
// plain strings, numbers, dates, booleans or ObjectIds of the column's type.
//
// Paging is by cursor (keyset), not skip: rows are ordered by the sort columns and then _id,
// and the cursor holds the last row's sort values, so a page starts right after it even when
// rows are added or deleted in between.
import { HttpException, HttpStatus } from '@nestjs/common';
import { ObjectId } from 'mongodb';
import { createHash } from 'crypto';
import { parse_utc_date } from '../date';

export type QueryColumnType = 'string' | 'number' | 'date';

export interface QueryColumn {
    // The name the API uses (the column name, or its camelCase/snakeCase key with `format`)
    name: string;
    // Also accepted in a query: the column name as typed in the grid
    header_name?: string;
    // The Mongo field ('a', 'b', ...)
    field: string;
    type: QueryColumnType;
}

export const OPERATORS = ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'contains', 'in', 'empty'];
export const DEFAULT_QUERY_LIMIT = 100;
// The largest page. The same for every plan until #137 sets limits per plan: change
// max_query_limit() then.
export const MAX_QUERY_LIMIT = 1000;
export const MAX_FILTERS = 20;
export const MAX_SORT = 5;
export const MAX_IN_VALUES = 100;
export const MAX_VALUE_LENGTH = 2000;
const MAX_CURSOR_LENGTH = 20000;
const QUERY_KEYS = ['filters', 'match', 'sort', 'fields', 'limit', 'cursor', 'explain'];
const COUNT_KEYS = ['filters', 'match'];
const FILTER_KEYS = ['column', 'op', 'value', 'case'];
const ID = '_id';

export function max_query_limit() {
    return MAX_QUERY_LIMIT;
}

export interface SortKey {
    field: string;
    dir: 1 | -1;
}

export interface RowQuery {
    filter: Record<string, any>;
    sort: SortKey[];
    // Columns to return, in order
    fields: QueryColumn[];
    // Mongo fields to read: the returned columns and the sort columns
    projection: Record<string, 1>;
    limit: number;
    explain: boolean;
}

export interface RowCountQuery {
    filter: Record<string, any>;
}

export function bad_request(message: string): never {
    throw new HttpException(message, HttpStatus.BAD_REQUEST);
}

function is_plain_object(value: unknown): value is Record<string, unknown> {
    return (
        value !== null &&
        typeof value === 'object' &&
        !Array.isArray(value) &&
        Object.getPrototypeOf(value) === Object.prototype
    );
}

function check_keys(obj: Record<string, unknown>, allowed: string[], what: string) {
    const unknown = Object.keys(obj).filter(k => !allowed.includes(k));
    if (unknown.length > 0) {
        bad_request(
            `Unknown ${what} key: ${unknown[0]}. Allowed: ${allowed.join(', ')}`.slice(0, 300)
        );
    }
}

function show(value: unknown) {
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    return text === undefined ? String(value) : text.slice(0, 100);
}

// Finds a column by its API name or its name in the grid
function column_lookup(columns: QueryColumn[]) {
    const by_name = new Map<string, QueryColumn>();
    columns.forEach(c => c.header_name && by_name.set(c.header_name, c));
    columns.forEach(c => by_name.set(c.name, c));
    return (name: unknown, where: string): QueryColumn | 'id' => {
        if (name === ID) return 'id';
        if (typeof name !== 'string' || name.length === 0) {
            bad_request(`${where}: a column name (string) is required`);
        }
        const col = by_name.get(name);
        if (!col) bad_request(`${where}: unknown column ${show(name)}`);
        return col;
    };
}

// --- Values ---

function to_object_id(value: unknown, where: string) {
    if (typeof value !== 'string' || !/^[0-9a-fA-F]{24}$/.test(value)) {
        bad_request(`${where}: _id values must be 24-character hex strings`);
    }
    return new ObjectId(value);
}

function to_value(col: QueryColumn, value: unknown, where: string) {
    if (col.type === 'number') {
        if (typeof value !== 'number' || !isFinite(value)) {
            bad_request(`${where}: ${col.name} is a number column, so the value must be a number`);
        }
        return value;
    }
    if (col.type === 'date') {
        const date = typeof value === 'string' ? parse_utc_date(value) : null;
        if (!date || isNaN(date.getTime())) {
            bad_request(
                `${where}: ${col.name} is a date column, so the value must be a date string such as 2024-01-15`
            );
        }
        return date;
    }
    if (typeof value === 'number' && isFinite(value)) return String(value);
    if (typeof value !== 'string') {
        bad_request(`${where}: ${col.name} is a text column, so the value must be a string`);
    }
    if (value.length > MAX_VALUE_LENGTH) {
        bad_request(`${where}: values can't be longer than ${MAX_VALUE_LENGTH} characters`);
    }
    return value;
}

function escape_regexp(s: string) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// --- Filters ---

function id_condition(op: string, value: unknown, where: string) {
    if (op === 'eq') return { _id: to_object_id(value, where) };
    if (op === 'ne') return { _id: { $ne: to_object_id(value, where) } };
    if (op === 'in') return { _id: { $in: in_values(value, where, v => to_object_id(v, where)) } };
    return bad_request(`${where}: _id takes eq, ne or in`);
}

function in_values(value: unknown, where: string, convert: (v: unknown) => unknown) {
    if (!Array.isArray(value) || value.length === 0 || value.length > MAX_IN_VALUES) {
        bad_request(`${where}: in takes an array of 1 to ${MAX_IN_VALUES} values`);
    }
    return value.map(convert);
}

function column_condition(col: QueryColumn, filter: Record<string, unknown>, where: string) {
    const { op, value } = filter;
    const f = col.field;
    if (filter.case !== undefined && op !== 'contains') {
        bad_request(`${where}: case only applies to contains`);
    }
    switch (op) {
        case 'eq':
            return { [f]: to_value(col, value, where) };
        case 'ne':
            return { [f]: { $ne: to_value(col, value, where) } };
        case 'gt':
        case 'gte':
        case 'lt':
        case 'lte':
            return { [f]: { [`$${op}`]: to_value(col, value, where) } };
        case 'in':
            return { [f]: { $in: in_values(value, where, v => to_value(col, v, where)) } };
        case 'contains': {
            if (col.type !== 'string') {
                bad_request(`${where}: contains only works on text columns`);
            }
            const text = to_value(col, value, where) as string;
            if (text.length === 0) bad_request(`${where}: contains needs a non-empty value`);
            if (![undefined, 'sensitive', 'insensitive'].includes(filter.case as string)) {
                bad_request(`${where}: case must be sensitive or insensitive`);
            }
            const options = filter.case === 'sensitive' ? '' : 'i';
            return { [f]: { $regex: escape_regexp(text), $options: options } };
        }
        case 'empty':
            if (typeof value !== 'boolean') {
                bad_request(`${where}: empty takes true (is empty) or false (is not empty)`);
            }
            return { [f]: value ? { $in: [null, ''] } : { $nin: [null, ''] } };
        default:
            return bad_request(
                `${where}: unknown operator ${show(op)}. Use one of ${OPERATORS.join(', ')}`
            );
    }
}

function parse_filters(body: Record<string, unknown>, columns: QueryColumn[]) {
    const { filters, match } = body;
    if (match !== undefined && match !== 'all' && match !== 'any') {
        bad_request('match must be all or any');
    }
    if (filters === undefined) return {};
    if (!Array.isArray(filters)) {
        bad_request('filters must be an array of { column, op, value }');
    }
    if (filters.length > MAX_FILTERS) bad_request(`At most ${MAX_FILTERS} filters`);
    const find = column_lookup(columns);
    const conditions = filters.map((filter, i) => {
        const where = `filters[${i}]`;
        if (!is_plain_object(filter)) bad_request(`${where} must be an object`);
        check_keys(filter, FILTER_KEYS, `${where}`);
        if (typeof filter.op !== 'string') bad_request(`${where}: op is required`);
        if (filter.value === undefined) bad_request(`${where}: value is required`);
        const col = find(filter.column, where);
        if (col === 'id') return id_condition(filter.op, filter.value, where);
        return column_condition(col, filter, where);
    });
    if (conditions.length === 0) return {};
    return { [match === 'any' ? '$or' : '$and']: conditions };
}

// --- Sort ---

function parse_sort(sort: unknown, columns: QueryColumn[]): SortKey[] {
    if (sort === undefined) return [{ field: ID, dir: 1 }];
    if (!Array.isArray(sort)) {
        bad_request(
            'sort must be an array of column names ("-name" for descending) or { column, dir }'
        );
    }
    if (sort.length > MAX_SORT) bad_request(`At most ${MAX_SORT} sort columns`);
    const find = column_lookup(columns);
    const keys: SortKey[] = [];
    sort.forEach((item, i) => {
        const where = `sort[${i}]`;
        let name: unknown;
        let dir: unknown = 'asc';
        if (typeof item === 'string') {
            name = item.startsWith('-') ? item.slice(1) : item;
            dir = item.startsWith('-') ? 'desc' : 'asc';
        } else if (is_plain_object(item)) {
            check_keys(item, ['column', 'dir'], where);
            name = item.column;
            dir = item.dir === undefined ? 'asc' : item.dir;
        } else {
            bad_request(`${where} must be a column name or { column, dir }`);
        }
        if (dir !== 'asc' && dir !== 'desc') bad_request(`${where}: dir must be asc or desc`);
        const col = find(name, where);
        const field = col === 'id' ? ID : col.field;
        if (keys.some(k => k.field === field))
            bad_request(`${where}: ${show(name)} is sorted twice`);
        if (keys.some(k => k.field === ID))
            bad_request(`${where}: _id must be the last sort column`);
        keys.push({ field, dir: dir === 'desc' ? -1 : 1 });
    });
    // _id breaks ties, so the order (and so the cursor) is stable
    if (!keys.some(k => k.field === ID)) keys.push({ field: ID, dir: 1 });
    return keys;
}

// --- Fields ---

function parse_fields(fields: unknown, columns: QueryColumn[]) {
    if (fields === undefined) return columns;
    if (!Array.isArray(fields) || fields.length === 0) {
        bad_request('fields must be a non-empty array of column names');
    }
    const find = column_lookup(columns);
    const out: QueryColumn[] = [];
    fields.forEach((name, i) => {
        const col = find(name, `fields[${i}]`);
        if (col !== 'id' && !out.includes(col)) out.push(col);
    });
    return out;
}

function parse_limit(limit: unknown, max: number) {
    if (limit === undefined) return Math.min(DEFAULT_QUERY_LIMIT, max);
    if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > max) {
        bad_request(`limit must be a whole number from 1 to ${max}`);
    }
    return limit;
}

// --- Cursors ---

type CursorValue = null | number | string | { d: string } | { o: string };

function encode_value(value: unknown): CursorValue {
    if (value === undefined || value === null) return null;
    if (value instanceof Date) return { d: value.toISOString() };
    if (value instanceof ObjectId) return { o: value.toHexString() };
    if (typeof value === 'number' || typeof value === 'string') return value;
    // Anything else in a row (a boolean from an old import) sorts with the strings' neighbours;
    // store it as text so the cursor stays decodable
    return String(value);
}

function decode_value(value: unknown) {
    if (value === null) return null;
    if (typeof value === 'number' && isFinite(value)) return value;
    if (typeof value === 'string' && value.length <= MAX_VALUE_LENGTH) return value;
    if (is_plain_object(value)) {
        const keys = Object.keys(value);
        if (keys.length === 1 && keys[0] === 'd' && typeof value.d === 'string') {
            const date = new Date(value.d);
            if (!isNaN(date.getTime())) return date;
        }
        if (
            keys.length === 1 &&
            keys[0] === 'o' &&
            typeof value.o === 'string' &&
            /^[0-9a-f]{24}$/.test(value.o)
        ) {
            return new ObjectId(value.o);
        }
    }
    return bad_request('cursor is not valid');
}

// Ties a cursor to the query it came from (filters, match and sort), so it isn't used with
// another one by mistake
function query_signature(body: Record<string, unknown>, sort: SortKey[]) {
    const basis = JSON.stringify([body.filters ?? null, body.match ?? 'all', sort]);
    return createHash('sha256').update(basis).digest('base64url').slice(0, 16);
}

export function encode_cursor(row: Record<string, unknown>, sort: SortKey[], signature: string) {
    const payload = { s: signature, v: sort.map(k => encode_value(row[k.field])) };
    return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

export function decode_cursor(cursor: unknown, sort: SortKey[], signature: string) {
    if (typeof cursor !== 'string' || cursor.length === 0 || cursor.length > MAX_CURSOR_LENGTH) {
        bad_request('cursor must be the next_cursor string from a previous page');
    }
    let payload: unknown;
    try {
        payload = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    } catch {
        bad_request('cursor is not valid');
    }
    if (
        !is_plain_object(payload) ||
        !Array.isArray(payload.v) ||
        payload.v.length !== sort.length
    ) {
        bad_request('cursor is not valid');
    }
    if (payload.s !== signature) {
        bad_request('cursor is from a query with other filters or sort');
    }
    const values = payload.v.map(decode_value);
    if (!(values[values.length - 1] instanceof ObjectId)) bad_request('cursor is not valid');
    return values;
}

// The rows after `values` in the sort order. Mongo sorts null (and missing) before every
// value, so ascending a null is followed by the non-null values, and descending the nulls come
// last. Comparisons ($gt, $lt) only match values of the same type, which is how a column's
// values are stored (empty cells are null).
export function after_cursor(sort: SortKey[], values: unknown[]) {
    const branches = [];
    for (let i = 0; i < sort.length; i++) {
        const { field, dir } = sort[i];
        const v = values[i];
        let after;
        if (v === null) {
            if (dir === -1) continue; // nothing comes after the nulls
            after = { [field]: { $ne: null } };
        } else if (dir === 1) {
            after = { [field]: { $gt: v } };
        } else {
            after = { $or: [{ [field]: { $lt: v } }, { [field]: null }] };
        }
        const equal = sort.slice(0, i).map((k, j) => ({ [k.field]: values[j] }));
        branches.push(equal.length > 0 ? { $and: [...equal, after] } : after);
    }
    return { $or: branches };
}

function and(...filters: Record<string, any>[]) {
    const parts = filters.filter(f => Object.keys(f).length > 0);
    if (parts.length === 0) return {};
    if (parts.length === 1) return parts[0];
    return { $and: parts };
}

function check_body(body: unknown, allowed: string[]): Record<string, unknown> {
    if (body === undefined || body === null) return {};
    if (!is_plain_object(body)) bad_request('The body must be a JSON object');
    check_keys(body, allowed, 'body');
    return body;
}

export interface ParsedRowQuery extends RowQuery {
    signature: string;
}

export function parse_row_query(
    raw_body: unknown,
    columns: QueryColumn[],
    max_limit = MAX_QUERY_LIMIT
): ParsedRowQuery {
    const body = check_body(raw_body, QUERY_KEYS);
    if (body.explain !== undefined && typeof body.explain !== 'boolean') {
        bad_request('explain must be true or false');
    }
    const where = parse_filters(body, columns);
    const sort = parse_sort(body.sort, columns);
    const fields = parse_fields(body.fields, columns);
    const limit = parse_limit(body.limit, max_limit);
    const signature = query_signature(body, sort);
    const filter =
        body.cursor === undefined || body.cursor === null
            ? where
            : and(where, after_cursor(sort, decode_cursor(body.cursor, sort, signature)));
    const projection: Record<string, 1> = { [ID]: 1 };
    fields.forEach(c => (projection[c.field] = 1));
    sort.forEach(k => (projection[k.field] = 1));
    return { filter, sort, fields, projection, limit, explain: body.explain === true, signature };
}

export function parse_count_query(raw_body: unknown, columns: QueryColumn[]): RowCountQuery {
    const body = check_body(raw_body, COUNT_KEYS);
    return { filter: parse_filters(body, columns) };
}

export function mongo_sort(sort: SortKey[]) {
    const out: Record<string, 1 | -1> = {};
    sort.forEach(k => (out[k.field] = k.dir));
    return out;
}

// The columns whose index the winning plan of an `explain('queryPlanner')` reads
export function explain_indexes(explain: any, columns: QueryColumn[]) {
    const fields = new Set<string>();
    const visit = (stage: any) => {
        if (!stage || typeof stage !== 'object') return;
        if (stage.keyPattern && typeof stage.keyPattern === 'object') {
            Object.keys(stage.keyPattern).forEach(f => fields.add(f));
        }
        if (stage.inputStage) visit(stage.inputStage);
        if (Array.isArray(stage.inputStages)) stage.inputStages.forEach(visit);
        if (stage.queryPlan) visit(stage.queryPlan);
    };
    const planner = explain && explain.queryPlanner;
    visit(planner && planner.winningPlan);
    const names = [...fields].map(f =>
        f === ID ? ID : (columns.find(c => c.field === f) || { name: f }).name
    );
    return { uses_index: names.length > 0, index_columns: names };
}
