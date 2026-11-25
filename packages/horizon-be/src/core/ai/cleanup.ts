// AI data cleanup (#206): "Clean up" in Ask AI scans the first CLEANUP_MAX_ROWS rows of a table
// for likely problems and answers each with a fix to review, never applied by itself. Cheap
// checks run here, in code: stray spaces, invalid emails and phone numbers, numbers and dates
// written in mixed formats, the same value in different capitals, and exact duplicate rows.
// The model (one structured-output call, through the service) judges only what code can't:
// different spellings of the same value and near-duplicate rows, sent only the columns
// involved. Pure functions, unit-tested in cleanup.spec.ts; the service is
// application/ai/cleanup.service.ts.
//
// A fix is an edit like #204's (rows with their changed cells before and after, applied through
// apply-edit only where a row still holds `before`) or a list of duplicate rows to delete. The
// checks run one after another on a working copy of the cells, so a later check sees the values
// as the earlier fixes leave them: each fix's `after` is the cell with every fix up to it, and
// its `before` is always the cell as stored. Picking several fixes of one cell, the app keeps
// the last one's `after`.
import { QueryColumn } from '../web-file/row-query';
import { AskError } from './ask';
import { EditedRow, EditRow, cell_value, same_value } from './edit';

export const CLEANUP_MAX_ROWS = 500;
// Examples shown per problem
export const CLEANUP_EXAMPLES = 3;
// What the model is sent: columns whose values it compares for spellings, columns it reads for
// near-duplicates, distinct values per column, characters of a cell, and of the whole request
export const CLEANUP_AI_LIMITS = {
    spelling_columns: 6,
    spelling_values: 60,
    duplicate_columns: 4,
    cell_length: 80,
    request_chars: 30000,
    groups: 50
};
// Share of a column's values that must be numbers (or dates) before the others count as a
// problem of format
const MOSTLY = 0.6;

export type CleanupKind =
    | 'whitespace'
    | 'email'
    | 'phone'
    | 'number_format'
    | 'date_format'
    | 'case'
    | 'spelling'
    | 'duplicate'
    | 'near_duplicate';

export interface CleanupColumn {
    field: string;
    name: string;
    type: string;
}

export interface DeleteRow {
    _id: string;
    // The row as stored, keyed by field: the delete is made only if it still holds this, and
    // Undo makes it again from it
    before: Record<string, unknown>;
    // The row it duplicates, which stays
    duplicate_of: string;
    reason?: string;
}

export interface CleanupProblem {
    id: string;
    kind: CleanupKind;
    // 'rules' for the checks in code, 'ai' for the model's
    source: 'rules' | 'ai';
    column: CleanupColumn | null;
    title: string;
    detail: string;
    // Rows with the problem; `fixable` of them have a fix
    count: number;
    fixable: number;
    examples: string[];
    edit: { columns: CleanupColumn[]; rows: EditedRow[] } | null;
    delete: { columns: CleanupColumn[]; rows: DeleteRow[] } | null;
}

type Row = EditRow & { _id: unknown };

const rows_text = (n: number) => `${n} row${n === 1 ? '' : 's'}`;

function is_empty(value: unknown) {
    return value === null || value === undefined || value === '';
}

function quote(value: unknown) {
    const text = is_empty(value) ? '(empty)' : String(value);
    return JSON.stringify(text.length > 60 ? `${text.slice(0, 57)}...` : text);
}

function col_of(c: QueryColumn): CleanupColumn {
    return { field: c.field, name: c.name, type: c.type };
}

// --- The working copy ---

/** The cells as each fix leaves them, so a later check sees the earlier fixes. */
export class Working {
    private cells: Map<string, unknown>[];

    constructor(readonly rows: Row[]) {
        this.cells = rows.map(() => new Map());
    }

    get(i: number, field: string) {
        const m = this.cells[i];
        const v = m.has(field) ? m.get(field) : this.rows[i][field];
        return is_empty(v) ? null : v;
    }

    stored(i: number, field: string) {
        const v = this.rows[i][field];
        return is_empty(v) ? null : v;
    }

    set(i: number, field: string, value: unknown) {
        this.cells[i].set(field, value);
    }
}

/**
 * Runs `fix` on every text cell of `col` (as earlier fixes left it): a new value, or undefined
 * to leave it. Answers the edit rows (before as stored, after as fixed) and the examples.
 */
function fix_column(
    working: Working,
    col: QueryColumn,
    fix: (text: string, i: number) => string | undefined,
    skip?: Set<number>
) {
    const rows: EditedRow[] = [];
    const examples: string[] = [];
    working.rows.forEach((row, i) => {
        if (skip && skip.has(i)) return;
        const value = working.get(i, col.field);
        if (value === null || typeof value !== 'string') return;
        const next = fix(value, i);
        if (next === undefined || next === value) return;
        working.set(i, col.field, next);
        const before = working.stored(i, col.field);
        if (same_value(col.type, before, next)) return;
        rows.push({
            _id: String(row._id),
            before: { [col.field]: before },
            after: { [col.field]: is_empty(next) ? null : next }
        });
        if (examples.length < CLEANUP_EXAMPLES) {
            examples.push(`${quote(value)} → ${quote(next)}`);
        }
    });
    return { rows, examples };
}

function edit_problem(
    kind: CleanupKind,
    col: QueryColumn,
    title: string,
    detail: string,
    fixed: { rows: EditedRow[]; examples: string[] },
    extra: { count?: number; examples?: string[] } = {}
): CleanupProblem {
    const examples = [...fixed.examples, ...(extra.examples || [])].slice(0, CLEANUP_EXAMPLES);
    return {
        id: `${kind}:${col.field}`,
        kind,
        source: kind === 'spelling' ? 'ai' : 'rules',
        column: col_of(col),
        title,
        detail,
        count: fixed.rows.length + (extra.count || 0),
        fixable: fixed.rows.length,
        examples,
        edit: fixed.rows.length > 0 ? { columns: [col_of(col)], rows: fixed.rows } : null,
        delete: null
    };
}

/** Non-empty text values of a column, with their row numbers, as the earlier fixes left them. */
function texts(working: Working, col: QueryColumn) {
    const out: { i: number; text: string }[] = [];
    working.rows.forEach((_r, i) => {
        const v = working.get(i, col.field);
        if (typeof v === 'string' && v !== '') out.push({ i, text: v });
    });
    return out;
}

// --- Stray spaces ---

export function tidy_spaces(text: string) {
    return text.trim().replace(/\s+/g, ' ');
}

function check_whitespace(working: Working, col: QueryColumn) {
    const fixed = fix_column(working, col, tidy_spaces);
    if (fixed.rows.length === 0) return null;
    return edit_problem(
        'whitespace',
        col,
        `Stray spaces in ${col.name}`,
        'Spaces at the start or end, or more than one in a row. The fix removes them.',
        fixed
    );
}

// --- Emails ---

const EMAIL = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:".]{2,}$/;

export function is_email(text: string) {
    return EMAIL.test(text) && !text.includes('..');
}

/** An invalid email made valid by removing what can't be in one, or null. */
export function fix_email(text: string): string | null {
    const fixed = text
        .trim()
        .replace(/^mailto:/i, '')
        .replace(/^<(.*)>$/, '$1')
        .replace(/\s+/g, '')
        .replace(/[.,;:]+$/, '');
    return is_email(fixed) ? fixed : null;
}

function is_email_column(working: Working, col: QueryColumn) {
    if (/e-?mail/i.test(col.name)) return true;
    const values = texts(working, col);
    return (
        values.length > 0 && values.filter(v => v.text.includes('@')).length >= values.length / 2
    );
}

function check_emails(working: Working, col: QueryColumn) {
    let unfixable = 0;
    const bad: string[] = [];
    const fixed = fix_column(working, col, text => {
        if (is_email(text)) return undefined;
        const f = fix_email(text);
        if (f) return f;
        unfixable++;
        if (bad.length < CLEANUP_EXAMPLES) bad.push(quote(text));
        return undefined;
    });
    if (fixed.rows.length === 0 && unfixable === 0) return null;
    const parts = [];
    if (fixed.rows.length > 0) {
        parts.push(
            `${rows_text(fixed.rows.length)} can be fixed (spaces, mailto:, a trailing dot).`
        );
    }
    if (unfixable > 0) {
        parts.push(`${rows_text(unfixable)} can't be fixed here: correct them in the grid.`);
    }
    return edit_problem('email', col, `Invalid emails in ${col.name}`, parts.join(' '), fixed, {
        count: unfixable,
        examples: bad
    });
}

// --- Phone numbers (listed only: there's no safe fix) ---

export function is_phone(text: string) {
    if (/[a-wyz]/i.test(text.replace(/\b(ext|x)\.?\s*\d+$/i, ''))) return false;
    const digits = text.replace(/\b(ext|x)\.?\s*\d+$/i, '').replace(/\D/g, '');
    return digits.length >= 7 && digits.length <= 15;
}

function check_phones(working: Working, col: QueryColumn): CleanupProblem | null {
    if (!/phone|mobile|\btel\b|\bcell\b/i.test(col.name)) return null;
    const bad = texts(working, col).filter(v => !is_phone(v.text));
    if (bad.length === 0) return null;
    return {
        id: `phone:${col.field}`,
        kind: 'phone',
        source: 'rules',
        column: col_of(col),
        title: `Invalid phone numbers in ${col.name}`,
        detail:
            'Too few or too many digits, or letters. There is no safe fix: correct them in ' +
            'the grid.',
        count: bad.length,
        fixable: 0,
        examples: bad.slice(0, CLEANUP_EXAMPLES).map(v => quote(v.text)),
        edit: null,
        delete: null
    };
}

// --- Numbers in a text column ---

const PLAIN_NUMBER = /^-?\d+(\.\d+)?$/;
const FORMATTED_NUMBER = /^([-+])?\s*[$€£¥]?\s*([-+])?\s*(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?\s*$/;

/** "$1,200.50" or "+ 12" as a plain number ("1200.50", "12"), or null. */
export function plain_number(text: string): string | null {
    const m = FORMATTED_NUMBER.exec(text.trim());
    if (!m || (m[1] && m[2])) return null;
    const sign = (m[1] || m[2]) === '-' ? '-' : '';
    return `${sign}${m[3].replace(/,/g, '')}${m[4] || ''}`;
}

function check_numbers(working: Working, col: QueryColumn) {
    const values = texts(working, col);
    const plain = values.filter(v => PLAIN_NUMBER.test(v.text)).length;
    if (values.length < 2 || plain === values.length || plain < values.length * MOSTLY) {
        return null;
    }
    let other = 0;
    const odd: string[] = [];
    const fixed = fix_column(working, col, text => {
        if (PLAIN_NUMBER.test(text)) return undefined;
        const n = plain_number(text);
        if (n !== null) return n;
        other++;
        if (odd.length < CLEANUP_EXAMPLES) odd.push(quote(text));
        return undefined;
    });
    if (fixed.rows.length === 0 && other === 0) return null;
    const parts = [];
    if (fixed.rows.length > 0) {
        parts.push('Currency signs and thousands separators are removed, as most rows have none.');
    }
    if (other > 0) parts.push(`${rows_text(other)} aren't numbers: check them in the grid.`);
    return edit_problem(
        'number_format',
        col,
        `Numbers in different formats in ${col.name}`,
        `${col.name} mostly holds plain numbers. ${parts.join(' ')}`,
        fixed,
        { count: other, examples: odd }
    );
}

// --- Dates in a text column ---

export type DateFormat = 'iso' | 'ymd_slash' | 'mdy' | 'dmy' | 'month_day_year' | 'day_month_year';

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTH_NAMES = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December'
];

interface Ymd {
    y: number;
    m: number;
    d: number;
}

function month_of(name: string) {
    const n = name.toLowerCase().replace(/\.$/, '');
    if (n === 'sept') return 9;
    const i = MONTHS.indexOf(n.slice(0, 3));
    if (i < 0) return 0;
    // "Janu" isn't a month; a full name or its first three letters are
    const full = MONTH_NAMES[i].toLowerCase();
    return n.length === 3 || n === full ? i + 1 : 0;
}

function valid(y: number, m: number, d: number): Ymd | null {
    if (y < 1000 || y > 9999 || m < 1 || m > 12 || d < 1) return null;
    const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return d <= days ? { y, m, d } : null;
}

/**
 * A text date's format and parts. Day/month/year with slashes ("03/04/2024") is `slash`: which
 * of the two comes first is decided per column (a part over 12 settles it).
 */
export function read_date(
    text: string
): { format: DateFormat | 'slash'; a: number; b: number; y: number } | null {
    const t = text.trim();
    let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
    if (m) return { format: 'iso', y: +m[1], a: +m[2], b: +m[3] };
    m = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(t);
    if (m) return { format: 'ymd_slash', y: +m[1], a: +m[2], b: +m[3] };
    m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(t);
    if (m) return { format: 'slash', a: +m[1], b: +m[2], y: +m[3] };
    m = /^([A-Za-z]{3,9}\.?)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/.exec(t);
    if (m && month_of(m[1])) {
        return { format: 'month_day_year', a: month_of(m[1]), b: +m[2], y: +m[3] };
    }
    m = /^(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9}\.?),?\s+(\d{4})$/.exec(t);
    if (m && month_of(m[2])) {
        return { format: 'day_month_year', a: month_of(m[2]), b: +m[1], y: +m[3] };
    }
    return null;
}

/** The date's day, month and year, with slash dates read as `slash_order`; null if invalid. */
function ymd_of(read: ReturnType<typeof read_date>, slash_order: 'mdy' | 'dmy' | null) {
    if (!read) return null;
    if (read.format === 'slash') {
        if (!slash_order) return null;
        return slash_order === 'mdy'
            ? valid(read.y, read.a, read.b)
            : valid(read.y, read.b, read.a);
    }
    // iso, ymd_slash, and the month-name formats: a is the month, b the day
    return valid(read.y, read.a, read.b);
}

const pad = (n: number) => String(n).padStart(2, '0');

export function write_date(date: Ymd, format: DateFormat) {
    const { y, m, d } = date;
    switch (format) {
        case 'iso':
            return `${y}-${pad(m)}-${pad(d)}`;
        case 'ymd_slash':
            return `${y}/${pad(m)}/${pad(d)}`;
        case 'mdy':
            return `${pad(m)}/${pad(d)}/${y}`;
        case 'dmy':
            return `${pad(d)}/${pad(m)}/${y}`;
        case 'month_day_year':
            return `${MONTH_NAMES[m - 1].slice(0, 3)} ${d}, ${y}`;
        case 'day_month_year':
            return `${d} ${MONTH_NAMES[m - 1].slice(0, 3)} ${y}`;
    }
}

const FORMAT_NAMES: Record<DateFormat, string> = {
    iso: '2024-01-31',
    ymd_slash: '2024/01/31',
    mdy: '01/31/2024',
    dmy: '31/01/2024',
    month_day_year: 'Jan 31, 2024',
    day_month_year: '31 Jan 2024'
};

function check_dates(working: Working, col: QueryColumn) {
    const values = texts(working, col);
    const read = values.map(v => ({ ...v, date: read_date(v.text) }));
    const dated = read.filter(v => v.date);
    if (values.length < 2 || dated.length < values.length * MOSTLY) return null;
    // Slash dates: a first part over 12 means day first, a second over 12 month first. Both, or
    // neither, and the column's slash dates can't be read safely.
    const slashes = dated.filter(v => v.date.format === 'slash');
    const day_first = slashes.some(v => v.date.a > 12);
    const month_first = slashes.some(v => v.date.b > 12);
    const slash_order = day_first === month_first ? null : day_first ? 'dmy' : 'mdy';
    // Each value's format, as the column reads it
    const format_of = (d: ReturnType<typeof read_date>): DateFormat | null =>
        d.format === 'slash' ? slash_order : d.format;
    const counts = new Map<DateFormat, number>();
    dated.forEach(v => {
        const f = format_of(v.date);
        if (f && ymd_of(v.date, slash_order)) counts.set(f, (counts.get(f) || 0) + 1);
    });
    if (counts.size === 0) return null;
    // The most common format (the first seen on a tie) is the one the others take
    let target: DateFormat = null;
    counts.forEach((n, f) => {
        if (!target || n > counts.get(target)) target = f;
    });
    let unclear = 0;
    const odd: string[] = [];
    const fixed = fix_column(working, col, text => {
        const d = read_date(text);
        const date = ymd_of(d, slash_order);
        if (!date) {
            unclear++;
            if (odd.length < CLEANUP_EXAMPLES) odd.push(quote(text));
            return undefined;
        }
        const out = write_date(date, target);
        return out === text.trim() ? undefined : out;
    });
    if (fixed.rows.length === 0) return null;
    const parts = [`${col.name} mostly holds dates written like ${FORMAT_NAMES[target]}.`];
    parts.push('The fix writes the others the same way.');
    if (unclear > 0) {
        parts.push(
            `${rows_text(unclear)} aren't dates, or can't be read for sure (is 03/04 March ` +
                'or April?): check them in the grid.'
        );
    }
    return edit_problem(
        'date_format',
        col,
        `Dates in different formats in ${col.name}`,
        parts.join(' '),
        fixed,
        { count: unclear, examples: odd }
    );
}

// --- The same value in different capitals ---

function check_case(working: Working, col: QueryColumn) {
    const groups = new Map<string, Map<string, number>>();
    texts(working, col).forEach(({ text }) => {
        const key = text.toLowerCase();
        if (!groups.has(key)) groups.set(key, new Map());
        const g = groups.get(key);
        g.set(text, (g.get(text) || 0) + 1);
    });
    const canonical = new Map<string, string>();
    groups.forEach((spellings, key) => {
        if (spellings.size < 2) return;
        let best: string = null;
        spellings.forEach((n, s) => {
            if (best === null || n > spellings.get(best)) best = s;
        });
        canonical.set(key, best);
    });
    if (canonical.size === 0) return null;
    const fixed = fix_column(working, col, text => canonical.get(text.toLowerCase()));
    if (fixed.rows.length === 0) return null;
    return edit_problem(
        'case',
        col,
        `The same value in different capitals in ${col.name}`,
        'Each value is written the way most rows write it.',
        fixed
    );
}

// --- Exact duplicates ---

function row_key(row: Row, columns: QueryColumn[]) {
    const cells = columns.map(c => (is_empty(row[c.field]) ? null : row[c.field]));
    if (cells.every(c => c === null)) return null;
    return JSON.stringify(cells);
}

/** The row's cells as stored, keyed by field (missing cells null). */
export function stored_cells(row: Row, columns: QueryColumn[]) {
    const cells: Record<string, unknown> = {};
    columns.forEach(c => (cells[c.field] = is_empty(row[c.field]) ? null : row[c.field]));
    return cells;
}

function describe_row(row: Row, columns: QueryColumn[]) {
    const cells = columns
        .map(c => row[c.field])
        .filter(v => !is_empty(v))
        .slice(0, 3)
        .map(v => String(v).slice(0, 30));
    return cells.join(' · ') || '(empty row)';
}

/** Exact duplicates: rows (not empty) whose every cell is the same as an earlier row's. */
export function find_duplicates(rows: Row[], columns: QueryColumn[]) {
    const first = new Map<string, number>();
    const dupes: { i: number; of: number }[] = [];
    rows.forEach((row, i) => {
        const key = row_key(row, columns);
        if (key === null) return;
        if (first.has(key)) dupes.push({ i, of: first.get(key) });
        else first.set(key, i);
    });
    return dupes;
}

function duplicate_problem(
    kind: 'duplicate' | 'near_duplicate',
    rows: Row[],
    columns: QueryColumn[],
    dupes: { i: number; of: number; reason?: string }[]
): CleanupProblem | null {
    if (dupes.length === 0) return null;
    const ai = kind === 'near_duplicate';
    return {
        id: kind,
        kind,
        source: ai ? 'ai' : 'rules',
        column: null,
        title: ai ? 'Possible duplicate rows' : 'Duplicate rows',
        detail: ai
            ? 'Rows that look like the same record written differently. Tick the ones to ' +
              'delete; the first of each stays.'
            : 'Rows with every cell the same as an earlier row. Tick the copies to delete; the ' +
              'first stays.',
        count: dupes.length,
        fixable: dupes.length,
        examples: dupes.slice(0, CLEANUP_EXAMPLES).map(d => describe_row(rows[d.i], columns)),
        edit: null,
        delete: {
            columns: columns.map(col_of),
            rows: dupes.map(d => {
                const out: DeleteRow = {
                    _id: String(rows[d.i]._id),
                    before: stored_cells(rows[d.i], columns),
                    duplicate_of: String(rows[d.of]._id)
                };
                if (d.reason) out.reason = d.reason;
                return out;
            })
        }
    };
}

/**
 * Whether every column of the table (`col_defs`, as stored) is among `columns`. Link columns
 * and a second column with the same name aren't (see ask_columns), so on such a table two rows
 * can look the same while their hidden cells differ, and deleting one (which Undo can't put
 * back whole) would lose them: no duplicate checks there.
 */
export function sees_whole_rows(col_defs: any[], columns: QueryColumn[]) {
    const fields = new Set(columns.map(c => c.field));
    return (col_defs || []).every(c => !c || c.field === undefined || fields.has(c.field));
}

// --- The checks in code ---

export interface RuleScan {
    problems: CleanupProblem[];
    working: Working;
    // Rows the exact-duplicate fix deletes, by row number
    duplicates: Set<number>;
    // Columns holding emails, phone numbers, numbers or dates (not sent for spellings)
    structured: Set<string>;
    // Whether rows were checked for duplicates (exact here, near ones by the model)
    duplicates_checked: boolean;
}

/**
 * The checks in code, on rows in API form keyed by field (dates as the grid shows them), in the
 * order their fixes build on each other: spaces, emails, phones, numbers, dates, capitals; then
 * exact duplicates (on the rows as stored), unless `whole_rows` is false (sees_whole_rows).
 */
export function scan_rules(rows: Row[], columns: QueryColumn[], whole_rows = true): RuleScan {
    const working = new Working(rows);
    const problems: CleanupProblem[] = [];
    const structured = new Set<string>();
    const add = (p: CleanupProblem | null) => p && problems.push(p);
    const text_cols = columns.filter(c => c.type === 'string');
    text_cols.forEach(c => add(check_whitespace(working, c)));
    text_cols.forEach(c => {
        if (is_email_column(working, c)) {
            structured.add(c.field);
            add(check_emails(working, c));
        } else if (/phone|mobile|\btel\b|\bcell\b/i.test(c.name)) {
            structured.add(c.field);
            add(check_phones(working, c));
        }
    });
    text_cols.forEach(c => {
        if (structured.has(c.field)) return;
        const n = check_numbers(working, c);
        const d = n ? null : check_dates(working, c);
        add(n);
        add(d);
        const values = texts(working, c);
        const numbers = values.filter(v => plain_number(v.text) !== null).length;
        const dates = values.filter(v => read_date(v.text)).length;
        if (values.length > 0 && Math.max(numbers, dates) >= values.length * MOSTLY) {
            structured.add(c.field);
        }
    });
    text_cols.forEach(c => add(check_case(working, c)));
    const dupes = whole_rows ? find_duplicates(rows, columns) : [];
    add(duplicate_problem('duplicate', rows, columns, dupes));
    return {
        problems,
        working,
        duplicates: new Set(dupes.map(d => d.i)),
        structured,
        duplicates_checked: whole_rows
    };
}

// --- What the model judges ---

export const CLEANUP_SYSTEM =
    'You check a table for data problems that code cannot judge. You get some columns with ' +
    'their distinct values and counts, and some rows (each starts with its row number). ' +
    'Report only clear cases. spellings: values of one column that mean the same thing but ' +
    'are written differently (abbreviations, typos, "NY" and "New York"); canonical is the ' +
    'value to keep, one of the values listed, usually the most common. Never group values ' +
    'that differ in meaning. near_duplicates: groups of row numbers that are the same real ' +
    'record written differently (a typo, a missing middle name); never rows that only share ' +
    'a value. Empty lists are a fine answer.';

export interface AiRequestColumn {
    column: string;
    field: string;
    values: { value: string; count: number }[];
}

export interface CleanupAiRequest {
    // Columns whose distinct values the model compares
    spellings: AiRequestColumn[];
    // Columns and rows it reads for near-duplicates; row n is rows[n] of the scan
    duplicate_columns: QueryColumn[];
    rows: { n: number; cells: string[] }[];
}

/**
 * What to send the model, or null when there's nothing for it: text columns with repeated
 * values (not emails, phones, numbers or dates) for spellings, and the text columns with mostly
 * distinct values for near-duplicates, of the rows that aren't exact duplicates. Cells are cut
 * to `cell_length`, and rows stop at `request_chars`.
 */
export function ai_request(
    rows: Row[],
    columns: QueryColumn[],
    scan: RuleScan
): CleanupAiRequest | null {
    const L = CLEANUP_AI_LIMITS;
    const spellings: AiRequestColumn[] = [];
    const duplicate_columns: QueryColumn[] = [];
    columns
        .filter(c => c.type === 'string')
        .forEach(c => {
            const counts = new Map<string, number>();
            const values = texts(scan.working, c);
            values.forEach(({ text }) => counts.set(text, (counts.get(text) || 0) + 1));
            if (values.length < 2) return;
            const distinct = counts.size;
            const categorical = distinct >= 2 && distinct <= L.spelling_values;
            const repeated = distinct <= values.length * 0.7;
            if (
                !scan.structured.has(c.field) &&
                categorical &&
                repeated &&
                spellings.length < L.spelling_columns
            ) {
                spellings.push({
                    column: c.name,
                    field: c.field,
                    values: [...counts.entries()]
                        .sort((a, b) => b[1] - a[1])
                        .map(([value, count]) => ({
                            value: value.slice(0, L.cell_length),
                            count
                        }))
                });
            } else if (
                scan.duplicates_checked &&
                distinct > values.length * 0.5 &&
                duplicate_columns.length < L.duplicate_columns
            ) {
                duplicate_columns.push(c);
            }
        });
    // The values are cut for the model; only those it can name back are kept
    spellings.forEach(s => (s.values = s.values.filter(v => v.value.length < L.cell_length)));
    const kept_spellings = spellings.filter(s => s.values.length >= 2);
    const out_rows: { n: number; cells: string[] }[] = [];
    if (duplicate_columns.length > 0) {
        let chars = 0;
        for (let n = 0; n < rows.length; n++) {
            if (scan.duplicates.has(n)) continue;
            const cells = duplicate_columns.map(c => {
                const v = scan.working.get(n, c.field);
                return v === null ? '' : String(v).slice(0, L.cell_length);
            });
            if (cells.every(c => c === '')) continue;
            chars += cells.reduce((s, c) => s + c.length + 4, 6);
            if (chars > L.request_chars) break;
            out_rows.push({ n, cells });
        }
    }
    const has_rows = out_rows.length >= 2;
    if (kept_spellings.length === 0 && !has_rows) return null;
    return {
        spellings: kept_spellings,
        duplicate_columns: has_rows ? duplicate_columns : [],
        rows: has_rows ? out_rows : []
    };
}

/** The prompt for the model: the columns' values and the rows, as JSON. */
export function ai_prompt(table_name: string, request: CleanupAiRequest) {
    const data: Record<string, unknown> = { table: table_name };
    if (request.spellings.length > 0) {
        data.columns = request.spellings.map(s => ({
            column: s.column,
            values: s.values.map(v => [v.value, v.count])
        }));
    }
    if (request.rows.length > 0) {
        data.rows = {
            header: ['row', ...request.duplicate_columns.map(c => c.name)],
            rows: request.rows.map(r => [r.n, ...r.cells])
        };
    }
    return (
        'Find different spellings of the same value in these columns (each value with its ' +
        'count), and rows that are the same record written differently.\n\n' +
        JSON.stringify(data)
    );
}

/** The JSON schema of the model's answer. */
export function ai_schema() {
    return {
        type: 'object',
        properties: {
            spellings: {
                type: 'array',
                items: {
                    type: 'object',
                    properties: {
                        column: { type: 'string' },
                        canonical: { type: 'string' },
                        variants: { type: 'array', items: { type: 'string' } }
                    },
                    required: ['column', 'canonical', 'variants'],
                    additionalProperties: false
                }
            },
            near_duplicates: {
                type: 'array',
                items: {
                    type: 'object',
                    properties: {
                        rows: { type: 'array', items: { type: 'integer' } },
                        reason: { type: 'string' }
                    },
                    required: ['rows', 'reason'],
                    additionalProperties: false
                }
            }
        },
        required: ['spellings', 'near_duplicates'],
        additionalProperties: false
    };
}

/**
 * The model's answer as problems with fixes, checked against what it was sent: a spelling's
 * column, canonical value and variants must be ones it was shown (a value in two groups keeps
 * the first), and a near-duplicate group's rows must be rows it was shown, two or more, each in
 * one group only. Anything else is dropped. Updates `scan.working` like the checks in code.
 */
export function ai_problems(
    raw: unknown,
    request: CleanupAiRequest,
    rows: Row[],
    columns: QueryColumn[],
    scan: RuleScan
): CleanupProblem[] {
    const problems: CleanupProblem[] = [];
    const answer = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
    const L = CLEANUP_AI_LIMITS;

    // Spellings, per column: variant → canonical
    const maps = new Map<string, Map<string, string>>();
    const spellings = Array.isArray(answer.spellings) ? answer.spellings.slice(0, L.groups) : [];
    spellings.forEach(g => {
        if (!g || typeof g !== 'object') return;
        const sent = request.spellings.find(s => s.column === g.column);
        if (!sent || typeof g.canonical !== 'string' || !Array.isArray(g.variants)) return;
        const known = new Set(sent.values.map(v => v.value));
        if (!known.has(g.canonical)) return;
        if (!maps.has(sent.field)) maps.set(sent.field, new Map());
        const map = maps.get(sent.field);
        // A value already mapped (or already a canonical value) stays as the first group says
        const canonicals = new Set(map.values());
        if (map.has(g.canonical)) return;
        g.variants.forEach(v => {
            if (typeof v !== 'string' || v === g.canonical || !known.has(v)) return;
            if (map.has(v) || canonicals.has(v)) return;
            map.set(v, g.canonical);
        });
    });
    columns.forEach(col => {
        const map = maps.get(col.field);
        if (!map || map.size === 0) return;
        const fixed = fix_column(scan.working, col, text => map.get(text));
        if (fixed.rows.length === 0) return;
        problems.push(
            edit_problem(
                'spelling',
                col,
                `Different spellings of the same value in ${col.name}`,
                'The AI found values that look like the same thing written differently. The ' +
                    'fix writes each the way it suggests; check them first.',
                fixed
            )
        );
    });

    // Near-duplicates: the first row of each group stays
    const shown = new Set(request.rows.map(r => r.n));
    const taken = new Set<number>();
    const dupes: { i: number; of: number; reason?: string }[] = [];
    const groups = Array.isArray(answer.near_duplicates)
        ? answer.near_duplicates.slice(0, L.groups)
        : [];
    groups.forEach(g => {
        if (!g || typeof g !== 'object' || !Array.isArray(g.rows)) return;
        const ns = [...new Set(g.rows)].filter(
            (n): n is number => Number.isInteger(n) && shown.has(n as number)
        );
        if (ns.length < 2 || ns.some(n => taken.has(n))) return;
        ns.sort((a, b) => a - b);
        ns.forEach(n => taken.add(n));
        const reason = typeof g.reason === 'string' ? g.reason.slice(0, 200) : undefined;
        ns.slice(1).forEach(n => dupes.push({ i: n, of: ns[0], reason }));
    });
    const near = duplicate_problem('near_duplicate', rows, columns, dupes);
    if (near) problems.push(near);
    return problems;
}

/** The answer's sentence: what was scanned and what was found. */
export function cleanup_answer(
    problems: CleanupProblem[],
    scanned: number,
    total: number,
    ai: 'checked' | 'none' | 'failed',
    duplicates_checked = true
) {
    const of = total > scanned ? `the first ${scanned} of ${total} rows` : rows_text(scanned);
    const lead =
        problems.length === 0
            ? `No problems found in ${of}.`
            : `Found ${problems.length} problem${problems.length === 1 ? '' : 's'} in ${of}. ` +
              'Tick the fixes you want, check them, then Apply.';
    const tail =
        ai === 'failed'
            ? " The AI part of the scan (spellings, near-duplicates) didn't answer; try again " +
              'later for those.'
            : '';
    const dupes = duplicates_checked
        ? ''
        : " Duplicate rows weren't checked: this table has link columns (or two columns with " +
          "the same name) the scan can't compare.";
    return lead + tail + dupes;
}

// --- Deleting duplicates (and putting them back) ---

function is_object(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** A row's cells keyed by field, every one a column of the table with a value of its type. */
function parse_cells(raw: unknown, by_field: Map<string, QueryColumn>, where: string) {
    if (!is_object(raw)) throw new AskError(`${where} must be an object of cells`);
    const fields = Object.keys(raw);
    if (fields.length === 0) throw new AskError(`${where} has no cells`);
    const cells: Record<string, unknown> = {};
    fields.forEach(f => {
        const col = by_field.get(f);
        if (!col) throw new AskError(`${where}: unknown column ${JSON.stringify(f.slice(0, 50))}`);
        cells[f] = cell_value(col, raw[f], where);
    });
    return cells;
}

function rows_of(body: unknown, shape: string) {
    if (!is_object(body) || !Array.isArray(body.rows)) {
        throw new AskError(`The body must be { rows: [${shape}] }`);
    }
    if (body.rows.length === 0) throw new AskError('rows is empty');
    if (body.rows.length > CLEANUP_MAX_ROWS) {
        throw new AskError(`At most ${CLEANUP_MAX_ROWS} rows at a time`);
    }
    return body.rows as unknown[];
}

/**
 * Checks a request to delete duplicate rows: `{ rows: [{ _id, before }] }`, `before` the row's
 * cells (keyed by field) as the scan showed them. A row is deleted only if it still holds them.
 */
export function parse_delete_body(body: unknown, columns: QueryColumn[]) {
    const by_field = new Map(columns.map(c => [c.field, c]));
    const ids = new Set<string>();
    return rows_of(body, '{ _id, before }').map((row, i) => {
        const where = `rows[${i}]`;
        if (!is_object(row)) throw new AskError(`${where} must be { _id, before }`);
        if (typeof row._id !== 'string' || !/^[0-9a-f]{24}$/i.test(row._id)) {
            throw new AskError(`${where}._id must be a row id`);
        }
        if (ids.has(row._id)) throw new AskError(`${where}: the row is in the list twice`);
        ids.add(row._id);
        return { _id: row._id, before: parse_cells(row.before, by_field, `${where}.before`) };
    });
}

/** Checks a request to put deleted rows back (Undo): `{ rows: [cells keyed by field] }`. */
export function parse_restore_body(body: unknown, columns: QueryColumn[]) {
    const by_field = new Map(columns.map(c => [c.field, c]));
    return rows_of(body, '{ <field>: value }').map((row, i) =>
        parse_cells(row, by_field, `rows[${i}]`)
    );
}
