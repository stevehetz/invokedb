// Shareable forms that add rows to a table (#145). Pure rules only (no I/O): what a form's
// settings may be, what the public sees of it, and how a submission is checked against the
// table's column types and turned into a row. form.manager.ts stores the forms.
import { randomBytes } from 'crypto';
import { parse_utc_date } from '../date';

export type FormColumnType = 'string' | 'number' | 'date';

// A table column as a form sees it
export interface FormColumn {
    // The Mongo field ('a', 'b', ...), which stays the same when the column is renamed
    field: string;
    name: string;
    type: FormColumnType;
}

// One question of the form: a column of the table
export interface FormField {
    field: string;
    // Shown instead of the column name; empty: the column name
    label: string;
    required: boolean;
    // A line of help under the field
    help: string;
}

export interface FormSettings {
    title: string;
    description: string;
    fields: FormField[];
    submit_label: string;
    // Shown after a submission, unless there's a redirect
    thank_you: string;
    // Where the browser goes after a submission (http or https), or null
    redirect_url: string | null;
    // A closed form shows "closed" and takes no submissions
    open: boolean;
}

export const FORM_LIMITS = {
    // Per account, until the plans in #137 set their own
    max_per_account: 50,
    max_title_length: 200,
    max_description_length: 2000,
    max_label_length: 200,
    max_help_length: 500,
    max_submit_label_length: 50,
    max_thank_you_length: 2000,
    max_url_length: 2048,
    // A text answer
    max_value_length: 10000
};

// Submissions, counted per client IP: on one form, and on all forms together. A submission that
// fails its checks counts too, so the limits also slow down probing.
export const FORM_RATE_LIMITS = {
    per_ip_per_form: 10,
    per_ip: 100,
    // And on one form from everyone, so a botnet can't fill a table in an hour
    per_form: 1000,
    window_ms: 10 * 60 * 1000,
    per_form_window_ms: 60 * 60 * 1000
};

// A hidden field of the public form. People don't see it, so they leave it empty; bots that
// fill every input don't. A submission with it filled is answered as if it was saved.
export const HONEYPOT_FIELD = 'website';

export const DEFAULT_SUBMIT_LABEL = 'Submit';
export const DEFAULT_THANK_YOU = 'Thanks! Your response has been recorded.';

// A refusal the user can act on; the HTTP layer answers it with a 400
export class FormError extends Error {
    // Per field (the column's `field`): what's wrong with that answer
    constructor(
        message: string,
        readonly errors: Record<string, string> = {}
    ) {
        super(message);
    }
}

function fail(message: string): never {
    throw new FormError(message);
}

export function new_form_id() {
    return `form_${randomBytes(12).toString('hex')}`;
}

/** True if the id looks like one new_form_id() made (so a lookup can skip anything else). */
export function is_form_id(id: unknown): id is string {
    return typeof id === 'string' && /^form_[0-9a-f]{24}$/.test(id);
}

/** A table's column definitions (as stored) as form columns, in the grid's order. */
export function form_columns(col_defs: any[]): FormColumn[] {
    return (Array.isArray(col_defs) ? col_defs : [])
        .filter(c => c && !c.deleted && typeof c.field === 'string' && c.field !== '')
        .slice()
        .sort((a, b) => (a.order ?? a.col_index ?? 0) - (b.order ?? b.col_index ?? 0))
        .map(c => ({
            field: c.field,
            name: typeof c.headerName === 'string' ? c.headerName : '',
            type: c.col_type === 'number' || c.col_type === 'date' ? c.col_type : 'string'
        }));
}

function text(value: unknown, name: string, max: number, required = false): string {
    if (value === undefined || value === null) value = '';
    if (typeof value !== 'string') fail(`${name} must be text`);
    const str = (value as string).trim();
    if (required && str === '') fail(`${name} is required`);
    if (str.length > max) fail(`${name} can't be longer than ${max} characters`);
    return str;
}

function bool(value: unknown, name: string): boolean {
    if (typeof value !== 'boolean') fail(`${name} must be true or false`);
    return value as boolean;
}

/** An http(s) URL to send the browser to after a submission; empty or null: none. */
export function parse_redirect_url(input: unknown): string | null {
    if (input === undefined || input === null) return null;
    if (typeof input !== 'string') fail('The redirect URL must be text');
    const str = (input as string).trim();
    if (str === '') return null;
    if (str.length > FORM_LIMITS.max_url_length) {
        fail(`The redirect URL can't be longer than ${FORM_LIMITS.max_url_length} characters`);
    }
    let url: URL;
    try {
        url = new URL(str);
    } catch {
        fail('The redirect URL is not a valid URL');
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
        fail('The redirect URL must start with https:// or http://');
    }
    if (url.username || url.password) fail("The redirect URL can't contain a user name");
    return url.toString();
}

/** The form's questions: each a column of the table, at most once, at least one. */
export function parse_fields(input: unknown, columns: FormColumn[]): FormField[] {
    if (!Array.isArray(input) || input.length === 0) fail('Pick at least one column');
    const by_field = new Map(columns.map(c => [c.field, c]));
    const seen = new Set<string>();
    return (input as unknown[]).map(item => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) {
            fail('Each field must be an object with a column');
        }
        const f = item as any;
        if (typeof f.field !== 'string' || !by_field.has(f.field)) {
            fail('A field names a column the table does not have');
        }
        if (seen.has(f.field))
            fail(`The column ${by_field.get(f.field).name} is in the form twice`);
        seen.add(f.field);
        return {
            field: f.field,
            label: text(f.label, 'A field label', FORM_LIMITS.max_label_length),
            required: f.required === undefined ? false : bool(f.required, 'required'),
            help: text(f.help, 'A field help text', FORM_LIMITS.max_help_length)
        };
    });
}

const SETTING_KEYS = [
    'title',
    'description',
    'fields',
    'submit_label',
    'thank_you',
    'redirect_url',
    'open'
];

/**
 * Checks a form's settings from the app. With `existing`, a change: only the keys given are
 * checked and returned. Without, a new form: the title and fields are required, the rest get
 * their defaults.
 */
export function parse_form_settings(
    body: unknown,
    columns: FormColumn[],
    existing?: FormSettings
): Partial<FormSettings> {
    const b: any = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
    for (const key of Object.keys(b)) {
        if (!SETTING_KEYS.includes(key) && key !== 'file_id') fail(`Unknown setting: ${key}`);
    }
    const has = (key: string) => !existing || b[key] !== undefined;
    const out: Partial<FormSettings> = {};
    if (has('title')) {
        out.title = text(b.title, 'The title', FORM_LIMITS.max_title_length, true);
    }
    if (has('description')) {
        out.description = text(
            b.description,
            'The description',
            FORM_LIMITS.max_description_length
        );
    }
    if (has('fields')) out.fields = parse_fields(b.fields, columns);
    if (has('submit_label')) {
        out.submit_label =
            text(b.submit_label, 'The button label', FORM_LIMITS.max_submit_label_length) ||
            DEFAULT_SUBMIT_LABEL;
    }
    if (has('thank_you')) {
        out.thank_you =
            text(b.thank_you, 'The thank-you message', FORM_LIMITS.max_thank_you_length) ||
            DEFAULT_THANK_YOU;
    }
    if (has('redirect_url')) out.redirect_url = parse_redirect_url(b.redirect_url);
    if (has('open')) out.open = b.open === undefined ? true : bool(b.open, 'open');
    return out;
}

export interface PublicFormField {
    key: string;
    label: string;
    type: FormColumnType;
    required: boolean;
    help: string;
}

export interface PublicForm {
    id: string;
    title: string;
    description: string;
    submit_label: string;
    fields: PublicFormField[];
    honeypot: string;
}

/**
 * What anyone with the link sees: the questions, with each column's type, and nothing about the
 * table or account. A field whose column has been deleted is left out.
 */
export function public_form(form: FormSettings & { id: string }, columns: FormColumn[]) {
    const by_field = new Map(columns.map(c => [c.field, c]));
    const fields: PublicFormField[] = [];
    for (const f of form.fields) {
        const col = by_field.get(f.field);
        if (!col) continue;
        fields.push({
            key: f.field,
            label: f.label || col.name || f.field,
            type: col.type,
            required: f.required,
            help: f.help
        });
    }
    const view: PublicForm = {
        id: form.id,
        title: form.title,
        description: form.description,
        submit_label: form.submit_label || DEFAULT_SUBMIT_LABEL,
        fields,
        honeypot: HONEYPOT_FIELD
    };
    return view;
}

const is_empty = (v: unknown) =>
    v === undefined || v === null || (typeof v === 'string' && v.trim() === '');

// An answer, as the column type stores it (null when empty)
function answer(value: unknown, type: FormColumnType): { value: any; error?: string } {
    if (is_empty(value)) return { value: null };
    if (type === 'number') {
        if (typeof value === 'number') {
            return Number.isFinite(value) ? { value } : { value: null, error: 'Enter a number' };
        }
        if (typeof value !== 'string') return { value: null, error: 'Enter a number' };
        const str = value.trim().replace(/,/g, '');
        // The whole answer must be a number, not just its start ("12abc")
        if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(str)) {
            return { value: null, error: 'Enter a number' };
        }
        const num = Number(str);
        return Number.isFinite(num) ? { value: num } : { value: null, error: 'Enter a number' };
    }
    if (type === 'date') {
        if (typeof value !== 'string') return { value: null, error: 'Enter a date' };
        const date = parse_utc_date(value);
        if (isNaN(date.getTime())) return { value: null, error: 'Enter a date' };
        return { value: date };
    }
    if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
        return { value: null, error: 'Enter text' };
    }
    const str = String(value).trim();
    if (str.length > FORM_LIMITS.max_value_length) {
        return {
            value: null,
            error: `Can't be longer than ${FORM_LIMITS.max_value_length} characters`
        };
    }
    return { value: str };
}

export interface Submission {
    // True when the honeypot was filled: answer as if saved, but save nothing
    spam: boolean;
    // The new row, by Mongo field; every column of the form is there (null when left empty)
    row: Record<string, any>;
}

/**
 * Checks a submission (`{ values: { <field>: answer }, <honeypot>: '' }`) against the form's
 * questions and their columns' types. Throws a FormError with every wrong answer in `errors`.
 * Answers for columns that aren't in the form are refused, so a form can't write other columns.
 */
export function parse_submission(
    body: unknown,
    form: FormSettings,
    columns: FormColumn[]
): Submission {
    const b: any = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
    if (!is_empty(b[HONEYPOT_FIELD])) return { spam: true, row: {} };
    const values = b.values;
    if (!values || typeof values !== 'object' || Array.isArray(values)) {
        fail('The answers are missing');
    }
    const by_field = new Map(columns.map(c => [c.field, c]));
    const fields = form.fields.filter(f => by_field.has(f.field));
    if (fields.length === 0) fail('This form has no questions');
    const asked = new Set(fields.map(f => f.field));
    for (const key of Object.keys(values)) {
        if (!asked.has(key)) fail('An answer is for a question the form does not have');
    }
    const errors: Record<string, string> = {};
    const row: Record<string, any> = {};
    for (const f of fields) {
        const col = by_field.get(f.field);
        const res = answer(values[f.field], col.type);
        if (res.error) errors[f.field] = res.error;
        else if (res.value === null && f.required) errors[f.field] = 'This field is required';
        row[f.field] = res.value;
    }
    if (Object.keys(errors).length > 0) {
        throw new FormError('Some answers need a look', errors);
    }
    if (Object.values(row).every(v => v === null)) fail('The form is empty');
    return { spam: false, row };
}
