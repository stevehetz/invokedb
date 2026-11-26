// Editing data with natural language (#204): in Ask AI, "title-case every name", "fill the
// missing states from the city" or "split full_name into first and last" make the model call
// propose_edit, whose input is a spec, not code: the rows to change (the filters of
// /api/v1/query) and, per column, one change from a fixed list (set, copy, upper, title,
// replace, split, map, add...). Pure functions, unit-tested in edit.spec.ts; the service
// (application/ai/edit.service.ts) reads the rows and writes the edit.
//
// The spec is checked here against the table's columns (parse_row_query for the filters), then
// worked out row by row on the server into a preview of each changed row, before and after.
// Nothing is written until the user confirms; applying is an ordinary row update, made only
// where a row still holds the values the preview showed, so Undo is the same edit backwards.
import { HttpException } from '@nestjs/common';
import { format_date, parse_utc_date } from '../date';
import {
    MAX_FILTERS,
    MAX_VALUE_LENGTH,
    OPERATORS,
    ParsedRowQuery,
    QueryColumn,
    RowCountQuery,
    parse_count_query,
    parse_row_query
} from '../web-file/row-query';
import { AskError } from './ask';

export const EDIT_TOOL_NAME = 'propose_edit';
// The most rows one edit changes; a filter matching more previews (and changes) the first ones
export const EDIT_MAX_ROWS = 500;
// The most columns one edit changes
export const EDIT_MAX_CHANGES = 10;
export const EDIT_MAX_MAP_VALUES = 200;
export const EDIT_MAX_CONCAT_PARTS = 10;
const MAX_FIND_LENGTH = 200;
const MAX_SEPARATOR_LENGTH = 20;
const MAX_SPLIT_PART = 50;
const MAX_DECIMALS = 10;
const MAX_SUMMARY_LENGTH = 300;
// The grid's date format (WebFileManager.format_date_field)
const DATE_FORMAT = 'YYYY-MM-DD hh:mm:SS A';

export const EDIT_OPS = [
    'set',
    'clear',
    'copy',
    'upper',
    'lower',
    'title',
    'trim',
    'replace',
    'split',
    'map',
    'concat',
    'add',
    'multiply',
    'round'
] as const;
export type EditOp = (typeof EDIT_OPS)[number];

// The keys each change may have, besides column and op
const OP_KEYS: Record<EditOp, string[]> = {
    set: ['value'],
    clear: [],
    copy: ['from'],
    upper: ['from'],
    lower: ['from'],
    title: ['from'],
    trim: ['from'],
    replace: ['from', 'find', 'replace_with'],
    split: ['from', 'separator', 'part'],
    map: ['from', 'values'],
    concat: ['parts'],
    add: ['from', 'value'],
    multiply: ['from', 'value'],
    round: ['from', 'decimals']
};
const TEXT_OPS: EditOp[] = ['upper', 'lower', 'title', 'trim', 'replace', 'concat'];
const NUMBER_OPS: EditOp[] = ['add', 'multiply', 'round'];
const EDIT_KEYS = ['filters', 'match', 'changes', 'summary'];

export type ConcatPart = { column: QueryColumn } | { text: string };

export interface EditChange {
    column: QueryColumn;
    op: EditOp;
    // The column the new value is worked out from (the edited column itself by default)
    from: QueryColumn;
    value?: unknown;
    find?: string;
    replace_with?: string;
    separator?: string;
    part?: number;
    values?: Map<string, unknown>;
    parts?: ConcatPart[];
    decimals?: number;
}

export interface EditSpec {
    summary: string;
    changes: EditChange[];
    // The rows to change: the first EDIT_MAX_ROWS matching the filters, by _id
    query: ParsedRowQuery;
    count_query: RowCountQuery;
}

// A row in API form, keyed by Mongo field: text, numbers, dates as the grid shows them, or null
export type EditRow = Record<string, unknown>;

export interface EditedRow {
    _id: string;
    // The changed cells only, keyed by field
    before: Record<string, unknown>;
    after: Record<string, unknown>;
}

function is_plain_object(value: unknown): value is Record<string, unknown> {
    return (
        value !== null &&
        typeof value === 'object' &&
        !Array.isArray(value) &&
        Object.getPrototypeOf(value) === Object.prototype
    );
}

function show(value: unknown) {
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    return String(text).slice(0, 50);
}

/** A date as the grid shows it, or null when it isn't one. */
export function date_text(value: unknown): string | null {
    if (value === null || value === undefined || value === '') return null;
    const date = parse_utc_date(value);
    if (isNaN(date.getTime())) return null;
    return format_date(date, DATE_FORMAT, true);
}

// --- The tool ---

/** The propose_edit tool: which rows, and what changes in which columns. */
export function edit_tool(columns: QueryColumn[]) {
    const names = columns.map(c => c.name);
    const column = { type: 'string', enum: names };
    return {
        name: EDIT_TOOL_NAME,
        description:
            'Prepares a change to existing rows of the table for the user to review: the rows ' +
            'matching the filters (all rows without filters, at most ' +
            `${EDIT_MAX_ROWS}) and, for each column to change, one operation. It changes ` +
            'nothing itself: the user sees every changed row before and after and decides.',
        input_schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
                summary: {
                    type: 'string',
                    description: 'What the edit does, in one short sentence for the user'
                },
                filters: {
                    type: 'array',
                    maxItems: MAX_FILTERS,
                    description:
                        'The rows to change, as in run_query. Leave out to change every row. ' +
                        'To fill only empty cells, filter on that column with op empty, value true.',
                    items: {
                        type: 'object',
                        additionalProperties: false,
                        properties: {
                            column: { type: 'string', enum: [...names, '_id'] },
                            op: { type: 'string', enum: OPERATORS },
                            value: {},
                            case: { type: 'string', enum: ['sensitive', 'insensitive'] }
                        },
                        required: ['column', 'op', 'value']
                    }
                },
                match: { type: 'string', enum: ['all', 'any'] },
                changes: {
                    type: 'array',
                    minItems: 1,
                    maxItems: EDIT_MAX_CHANGES,
                    description:
                        'One per column to change. Every change reads the row as it was before ' +
                        'the edit. op: set (to value), clear (empty), copy (from another ' +
                        'column), upper, lower, title (Title Case), trim (spaces), replace ' +
                        '(find with replace_with, every time, case-sensitive), split (from ' +
                        'split on separator, keep part: 0 is the first, -1 the last), map ' +
                        "(values: an object from the from column's value to the new value; " +
                        'other rows are left as they are), concat (parts: [{ "column": name } ' +
                        'or { "text": "..." }]), add and multiply (by value), round (to ' +
                        'decimals). from defaults to the column itself. Text operations are ' +
                        'for text columns; add, multiply and round for number columns.',
                    items: {
                        type: 'object',
                        additionalProperties: false,
                        properties: {
                            column,
                            op: { type: 'string', enum: [...EDIT_OPS] },
                            from: column,
                            value: {},
                            find: { type: 'string' },
                            replace_with: { type: 'string' },
                            separator: { type: 'string' },
                            part: { type: 'integer' },
                            values: { type: 'object' },
                            parts: {
                                type: 'array',
                                maxItems: EDIT_MAX_CONCAT_PARTS,
                                items: {
                                    type: 'object',
                                    additionalProperties: false,
                                    properties: { column, text: { type: 'string' } }
                                }
                            },
                            decimals: { type: 'integer', minimum: 0, maximum: MAX_DECIMALS }
                        },
                        required: ['column', 'op']
                    }
                }
            },
            required: ['changes']
        }
    };
}

/** The lines of the Ask AI prompt about propose_edit. */
export function edit_prompt_lines() {
    return [
        `If the user asks to change, fix, fill in, clean up or reformat existing values, call ` +
            `${EDIT_TOOL_NAME} with the rows to change (filters) and one change per column. ` +
            'It only prepares the edit; the user reviews every changed row and decides. When ' +
            'the new values depend on values you have not seen (a map from city to state, ' +
            'say), call run_query first to read them. An edit changes at most ' +
            `${EDIT_MAX_ROWS} rows.`
    ];
}

// --- Checking the spec ---

function column_finder(columns: QueryColumn[]) {
    return (name: unknown, where: string): QueryColumn => {
        if (typeof name !== 'string' || name === '') {
            throw new AskError(`${where}: a column name is required`);
        }
        const col = columns.find(c => c.name === name) || columns.find(c => c.header_name === name);
        if (!col) throw new AskError(`${where}: unknown column ${show(name)}`);
        return col;
    };
}

/**
 * A value for a cell of `col`: a number for a number column, a date (as the grid shows it) for a
 * date column, text for a text column. `null` is allowed only with `allow_null`.
 */
export function typed_value(col: QueryColumn, value: unknown, where: string, allow_null = false) {
    if (value === null || value === undefined) {
        if (allow_null && value === null) return null;
        throw new AskError(`${where}: a value is required`);
    }
    if (col.type === 'number') {
        if (typeof value !== 'number' || !isFinite(value)) {
            throw new AskError(`${where}: ${col.name} is a number column, so use a number`);
        }
        return value;
    }
    if (col.type === 'date') {
        const date = typeof value === 'string' ? date_text(value) : null;
        if (!date) {
            throw new AskError(
                `${where}: ${col.name} is a date column, so use a date such as 2024-01-15`
            );
        }
        return date;
    }
    if (typeof value === 'number' && isFinite(value)) return String(value);
    if (typeof value !== 'string') {
        throw new AskError(`${where}: ${col.name} is a text column, so use text`);
    }
    if (value.length > MAX_VALUE_LENGTH) {
        throw new AskError(`${where}: values can't be longer than ${MAX_VALUE_LENGTH} characters`);
    }
    return value;
}

function text_arg(value: unknown, where: string, max: number, allow_empty: boolean) {
    if (typeof value !== 'string' || (!allow_empty && value === '')) {
        throw new AskError(`${where} must be ${allow_empty ? 'text' : 'non-empty text'}`);
    }
    if (value.length > max) throw new AskError(`${where} can be at most ${max} characters`);
    return value;
}

function parse_change(raw: unknown, i: number, find: ReturnType<typeof column_finder>) {
    const where = `changes[${i}]`;
    if (!is_plain_object(raw)) throw new AskError(`${where} must be an object`);
    const op = raw.op as EditOp;
    if (!EDIT_OPS.includes(op)) {
        throw new AskError(`${where}: op must be one of ${EDIT_OPS.join(', ')}`);
    }
    const allowed = ['column', 'op', ...OP_KEYS[op]];
    const unknown = Object.keys(raw).filter(k => !allowed.includes(k));
    if (unknown.length > 0) {
        throw new AskError(`${where}: ${op} doesn't take ${show(unknown[0])}`);
    }
    const column = find(raw.column, `${where}.column`);
    const from = raw.from === undefined ? column : find(raw.from, `${where}.from`);
    const change: EditChange = { column, op, from };
    if (TEXT_OPS.includes(op) && column.type !== 'string') {
        throw new AskError(`${where}: ${op} is for text columns, and ${column.name} isn't one`);
    }
    if (NUMBER_OPS.includes(op)) {
        if (column.type !== 'number' || from.type !== 'number') {
            throw new AskError(`${where}: ${op} is for number columns`);
        }
    }
    switch (op) {
        case 'set':
            change.value = typed_value(column, raw.value, `${where}.value`);
            break;
        case 'replace':
            change.find = text_arg(raw.find, `${where}.find`, MAX_FIND_LENGTH, false);
            change.replace_with = text_arg(
                raw.replace_with === undefined ? '' : raw.replace_with,
                `${where}.replace_with`,
                MAX_VALUE_LENGTH,
                true
            );
            break;
        case 'split': {
            change.separator = text_arg(
                raw.separator,
                `${where}.separator`,
                MAX_SEPARATOR_LENGTH,
                false
            );
            const part = raw.part === undefined ? 0 : raw.part;
            if (
                !Number.isInteger(part) ||
                Math.abs(part as number) > MAX_SPLIT_PART ||
                Object.is(part, -0)
            ) {
                throw new AskError(
                    `${where}.part must be a whole number (0 the first part, -1 the last)`
                );
            }
            change.part = part as number;
            break;
        }
        case 'map': {
            const values = raw.values;
            if (!is_plain_object(values)) {
                throw new AskError(`${where}.values must be an object of old value: new value`);
            }
            const keys = Object.keys(values);
            if (keys.length === 0 || keys.length > EDIT_MAX_MAP_VALUES) {
                throw new AskError(`${where}.values takes 1 to ${EDIT_MAX_MAP_VALUES} entries`);
            }
            change.values = new Map();
            keys.forEach(k => {
                if (k.length > MAX_FIND_LENGTH) {
                    throw new AskError(`${where}.values: keys can be at most ${MAX_FIND_LENGTH}`);
                }
                change.values.set(
                    k.trim(),
                    typed_value(column, values[k], `${where}.values[${show(k)}]`, true)
                );
            });
            break;
        }
        case 'concat': {
            const parts = raw.parts;
            if (!Array.isArray(parts) || parts.length === 0) {
                throw new AskError(`${where}.parts must be a non-empty array`);
            }
            if (parts.length > EDIT_MAX_CONCAT_PARTS) {
                throw new AskError(`${where}.parts: at most ${EDIT_MAX_CONCAT_PARTS}`);
            }
            change.parts = parts.map((p, j) => {
                const at = `${where}.parts[${j}]`;
                if (!is_plain_object(p) || Object.keys(p).length !== 1) {
                    throw new AskError(`${at} must be { "column": name } or { "text": "..." }`);
                }
                if ('column' in p) return { column: find(p.column, `${at}.column`) };
                if ('text' in p) return { text: text_arg(p.text, `${at}.text`, 200, true) };
                throw new AskError(`${at} must be { "column": name } or { "text": "..." }`);
            });
            break;
        }
        case 'add':
        case 'multiply':
            if (typeof raw.value !== 'number' || !isFinite(raw.value)) {
                throw new AskError(`${where}.value must be a number`);
            }
            change.value = raw.value;
            break;
        case 'round': {
            const decimals = raw.decimals === undefined ? 0 : raw.decimals;
            if (
                !Number.isInteger(decimals) ||
                (decimals as number) < 0 ||
                (decimals as number) > MAX_DECIMALS
            ) {
                throw new AskError(`${where}.decimals must be a whole number from 0 to 10`);
            }
            change.decimals = decimals as number;
            break;
        }
    }
    return change;
}

/**
 * Checks the model's propose_edit input against the table's columns and turns it into an edit:
 * the rows (the first EDIT_MAX_ROWS matching the filters) and one change per column.
 */
export function parse_edit_input(input: unknown, columns: QueryColumn[]): EditSpec {
    if (!is_plain_object(input)) throw new AskError('The input must be a JSON object');
    const unknown = Object.keys(input).filter(k => !EDIT_KEYS.includes(k));
    if (unknown.length > 0) {
        throw new AskError(`Unknown key: ${show(unknown[0])}. Allowed: ${EDIT_KEYS.join(', ')}`);
    }
    const raw = input.changes;
    if (!Array.isArray(raw) || raw.length === 0) {
        throw new AskError('changes must be a non-empty array of { column, op, ... }');
    }
    if (raw.length > EDIT_MAX_CHANGES) {
        throw new AskError(`An edit changes at most ${EDIT_MAX_CHANGES} columns`);
    }
    const find = column_finder(columns);
    const changes = raw.map((c, i) => parse_change(c, i, find));
    const seen = new Set<string>();
    changes.forEach(c => {
        if (seen.has(c.column.field)) {
            throw new AskError(`${c.column.name} is changed twice; one change per column`);
        }
        seen.add(c.column.field);
    });
    let summary = '';
    if (input.summary !== undefined) {
        if (typeof input.summary !== 'string') throw new AskError('summary must be text');
        summary = input.summary.trim().slice(0, MAX_SUMMARY_LENGTH);
    }
    const body: Record<string, unknown> = { limit: EDIT_MAX_ROWS };
    if (input.filters !== undefined) body.filters = input.filters;
    if (input.match !== undefined) body.match = input.match;
    try {
        const query = parse_row_query(body, columns, EDIT_MAX_ROWS);
        const count_query = parse_count_query(
            { filters: body.filters, match: body.match },
            columns
        );
        return { summary, changes, query, count_query };
    } catch (ex) {
        if (ex instanceof HttpException) throw new AskError(String(ex.message));
        throw ex;
    }
}

// --- Working out the edit ---

// A change that leaves the cell as it is (a value it can't convert, a key not in the map)
const KEEP = Symbol('keep');
type Result = unknown | typeof KEEP;

function is_empty(value: unknown) {
    return value === null || value === undefined || value === '';
}

/** A value for a cell of `col`, from another cell; KEEP when it can't be converted. */
function convert(col: QueryColumn, value: unknown): Result {
    if (is_empty(value)) return null;
    if (col.type === 'number') {
        if (typeof value === 'number') return isFinite(value) ? value : KEEP;
        const text = String(value).trim();
        const n = Number(text);
        return text !== '' && isFinite(n) ? n : KEEP;
    }
    if (col.type === 'date') return date_text(value) ?? KEEP;
    const text = String(value);
    return text.length > MAX_VALUE_LENGTH ? KEEP : text;
}

function title_case(text: string) {
    return text
        .toLowerCase()
        .replace(
            /(^|[^\p{L}\p{N}'’])(\p{L})/gu,
            (_m, before, letter) => before + letter.toUpperCase()
        );
}

// Removes the float noise of add and multiply (0.1 + 0.2)
function tidy(n: number) {
    return isFinite(n) ? parseFloat(n.toPrecision(12)) : KEEP;
}

function text_of(value: unknown) {
    return is_empty(value) ? null : String(value);
}

function work_out(change: EditChange, row: EditRow): Result {
    const source = row[change.from.field];
    const text = text_of(source);
    switch (change.op) {
        case 'set':
            return change.value;
        case 'clear':
            return null;
        case 'copy':
            return convert(change.column, source);
        case 'upper':
            return text === null ? KEEP : convert(change.column, text.toUpperCase());
        case 'lower':
            return text === null ? KEEP : convert(change.column, text.toLowerCase());
        case 'title':
            return text === null ? KEEP : convert(change.column, title_case(text));
        case 'trim':
            return text === null ? KEEP : convert(change.column, text.trim().replace(/\s+/g, ' '));
        case 'replace':
            return text === null
                ? KEEP
                : convert(change.column, text.split(change.find).join(change.replace_with));
        case 'split': {
            if (text === null) return KEEP;
            const parts = text
                .split(change.separator)
                .map(p => p.trim())
                .filter(p => p !== '');
            const i = change.part < 0 ? parts.length + change.part : change.part;
            return i >= 0 && i < parts.length ? convert(change.column, parts[i]) : null;
        }
        case 'map': {
            const key = text === null ? '' : text.trim();
            return change.values.has(key) ? change.values.get(key) : KEEP;
        }
        case 'concat': {
            const joined = change.parts
                .map(p => ('text' in p ? p.text : (text_of(row[p.column.field]) ?? '')))
                .join('')
                .trim();
            return convert(change.column, joined);
        }
        case 'add':
            return typeof source === 'number' ? tidy(source + (change.value as number)) : KEEP;
        case 'multiply':
            return typeof source === 'number' ? tidy(source * (change.value as number)) : KEEP;
        case 'round': {
            if (typeof source !== 'number') return KEEP;
            const f = Math.pow(10, change.decimals);
            return tidy(Math.round(source * f) / f);
        }
    }
}

/** Whether two values of a cell of this type are the same (empty text and null are). */
export function same_value(type: QueryColumn['type'], a: unknown, b: unknown) {
    if (is_empty(a) || is_empty(b)) return is_empty(a) && is_empty(b);
    if (type === 'number') return Number(a) === Number(b);
    // As the grid shows them, which is how the preview and the client hold them
    if (type === 'date') {
        const x = date_text(a);
        return x !== null && x === date_text(b);
    }
    return String(a) === String(b);
}

/** One row's changed cells, before and after, or null when the edit changes nothing in it. */
export function edit_row(changes: EditChange[], row: EditRow & { _id: unknown }): EditedRow | null {
    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    changes.forEach(change => {
        const field = change.column.field;
        const result = work_out(change, row);
        if (result === KEEP) return;
        const old = is_empty(row[field]) ? null : row[field];
        if (same_value(change.column.type, old, result)) return;
        before[field] = old;
        after[field] = is_empty(result) ? null : result;
    });
    if (Object.keys(after).length === 0) return null;
    return { _id: String(row._id), before, after };
}

/** What propose_edit answers the model: how many rows match and how many it changes. */
export function edit_result_content(matching: number, changed: number) {
    return JSON.stringify({
        total_matching: matching,
        rows_changed: changed,
        note:
            changed === 0
                ? 'The edit changes no rows.'
                : 'The user is shown the edit to review; nothing is changed yet.'
    });
}

/** The answer Ask AI shows with an edit's preview. */
export function edit_answer(summary: string, matching: number, changed: number) {
    const rows = (n: number) => `${n} row${n === 1 ? '' : 's'}`;
    const lead = summary ? `${summary.replace(/\.$/, '')}. ` : '';
    if (changed === 0) {
        return `${lead}${matching === 0 ? 'No rows match' : `None of the ${rows(matching)} would change`}, so there's nothing to edit.`;
    }
    const over =
        matching > EDIT_MAX_ROWS
            ? ` ${matching} rows match, but an edit changes at most ${EDIT_MAX_ROWS}, so only ` +
              `the first ${EDIT_MAX_ROWS} were looked at; apply it, then ask again for the rest.`
            : '';
    return `${lead}This changes ${rows(changed)}. Check them below, then Apply.${over}`;
}

// --- Applying an edit (and undoing one) ---

export interface ApplyRow {
    _id: string;
    before: Record<string, unknown>;
    after: Record<string, unknown>;
}

// No length cap here: a stored cell can be longer than MAX_VALUE_LENGTH (uploads, imports and
// row writes don't cap text), and it shows up as `before`, or as `after` when undoing.
export function cell_value(col: QueryColumn, value: unknown, where: string) {
    if (value === null) return null;
    if (col.type === 'number') {
        if (typeof value !== 'number' || !isFinite(value)) {
            throw new AskError(`${where}: ${col.name} takes a number or null`);
        }
        return value;
    }
    if (typeof value !== 'string') {
        throw new AskError(`${where}: ${col.name} takes text or null`);
    }
    if (col.type === 'date' && value !== '' && !date_text(value)) {
        throw new AskError(`${where}: ${col.name} takes a date or null`);
    }
    return value;
}

/**
 * Checks a request to apply (or undo) an edit: `{ rows: [{ _id, before, after }] }`, at most
 * EDIT_MAX_ROWS rows, each with the same columns (by field) in before and after, all of them
 * columns an edit can change, with values of the column's type.
 */
export function parse_apply_body(body: unknown, columns: QueryColumn[]): ApplyRow[] {
    if (!is_plain_object(body) || !Array.isArray(body.rows)) {
        throw new AskError('The body must be { rows: [{ _id, before, after }] }');
    }
    const rows = body.rows;
    if (rows.length === 0) throw new AskError('rows is empty');
    if (rows.length > EDIT_MAX_ROWS) {
        throw new AskError(`At most ${EDIT_MAX_ROWS} rows at a time`);
    }
    const by_field = new Map(columns.map(c => [c.field, c]));
    const ids = new Set<string>();
    return rows.map((row, i) => {
        const where = `rows[${i}]`;
        if (!is_plain_object(row) || !is_plain_object(row.before) || !is_plain_object(row.after)) {
            throw new AskError(`${where} must be { _id, before, after }`);
        }
        if (typeof row._id !== 'string' || !/^[0-9a-f]{24}$/i.test(row._id)) {
            throw new AskError(`${where}._id must be a row id`);
        }
        if (ids.has(row._id)) throw new AskError(`${where}: the row is in the edit twice`);
        ids.add(row._id);
        const fields = Object.keys(row.after);
        if (
            fields.length === 0 ||
            fields.length > EDIT_MAX_CHANGES ||
            fields.length !== Object.keys(row.before).length ||
            !fields.every(f => Object.prototype.hasOwnProperty.call(row.before, f))
        ) {
            throw new AskError(`${where}: before and after must have the same columns`);
        }
        const before: Record<string, unknown> = {};
        const after: Record<string, unknown> = {};
        fields.forEach(f => {
            const col = by_field.get(f);
            if (!col) throw new AskError(`${where}: unknown column ${show(f)}`);
            before[f] = cell_value(col, row.before[f], `${where}.before`);
            after[f] = cell_value(col, row.after[f], `${where}.after`);
        });
        return { _id: row._id, before, after };
    });
}

/** Whether a row (API form, keyed by field) still holds the values an edit's preview showed. */
export function row_unchanged_since(
    row: EditRow,
    before: Record<string, unknown>,
    columns: QueryColumn[]
) {
    const by_field = new Map(columns.map(c => [c.field, c]));
    return Object.keys(before).every(f =>
        same_value(by_field.get(f).type, row[f] === undefined ? null : row[f], before[f])
    );
}
