import * as fs from 'fs';
import * as path from 'path';
import { WebFileManager } from '../web-file/web-file.manager';
import { validate_file_dir_name } from '../helpers/validators';
import { parse_utc_date } from '../date';

// Table templates (#142): each `templates/<id>.json` file is one template, so adding a template
// is adding a file. The build copies the JSON next to the compiled code (tsconfig.build.json).

export type TemplateColumnType = 'string' | 'number' | 'date';

export interface TemplateColumn {
    name: string;
    type: TemplateColumnType;
}

export interface TableTemplate {
    id: string;
    name: string;
    description: string;
    /** The table name the "New table" dialog suggests. */
    table_name: string;
    columns: TemplateColumn[];
    /** Sample rows, keyed by column name. */
    rows: Record<string, string | number | null>[];
}

export const TEMPLATES_DIR = path.join(__dirname, 'templates');
export const COLUMN_TYPES: TemplateColumnType[] = ['string', 'number', 'date'];
export const MAX_TEMPLATE_COLUMNS = 52; // the column limit (TrackingManager.validate_column_count)
export const MAX_TEMPLATE_ROWS = 100;
const ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

const fail = (id: string, message: string): never => {
    throw new Error(`Template "${id}": ${message}`);
};

const non_empty_string = (value: unknown) => typeof value === 'string' && value.trim() !== '';

/**
 * Checks a parsed template file and returns it as a `TableTemplate`. Throws an Error naming the
 * template and the problem. The rules are the ones a table made by hand has to follow: a valid
 * table name, column names the grid accepts (no duplicates or reserved names), and sample values
 * that fit their column's type.
 */
export function validate_template(id: string, raw: unknown): TableTemplate {
    if (!ID_PATTERN.test(id)) fail(id, 'the file name must be lowercase letters, digits and -');
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
        fail(id, 'must be a JSON object');
    }
    const t = raw as Record<string, any>;

    if (!non_empty_string(t.name)) fail(id, '"name" must be a non-empty string');
    if (t.name.length > 60) fail(id, '"name" must be at most 60 characters');
    if (typeof t.description !== 'string') fail(id, '"description" must be a string');
    if (typeof t.table_name !== 'string' || !validate_file_dir_name(t.table_name)) {
        fail(id, '"table_name" must be alphanumeric, - or _');
    }
    if (t.table_name.length > 150) fail(id, '"table_name" must be at most 150 characters');

    if (!Array.isArray(t.columns) || t.columns.length === 0) {
        fail(id, '"columns" must be a non-empty array');
    }
    if (t.columns.length > MAX_TEMPLATE_COLUMNS) {
        fail(id, `"columns" can have at most ${MAX_TEMPLATE_COLUMNS} entries`);
    }
    const seen: { headerName: string }[] = [];
    const columns: TemplateColumn[] = t.columns.map((col, i) => {
        if (col === null || typeof col !== 'object' || Array.isArray(col)) {
            fail(id, `column ${i + 1} must be an object`);
        }
        try {
            WebFileManager.prototype.validate_column_header.call({}, seen, col.name);
        } catch (ex) {
            fail(id, `column ${i + 1}: ${ex.message}`);
        }
        if (!COLUMN_TYPES.includes(col.type)) {
            fail(id, `column "${col.name}": "type" must be one of ${COLUMN_TYPES.join(', ')}`);
        }
        seen.push({ headerName: col.name });
        return { name: col.name, type: col.type };
    });

    if (!Array.isArray(t.rows)) fail(id, '"rows" must be an array');
    if (t.rows.length > MAX_TEMPLATE_ROWS) {
        fail(id, `"rows" can have at most ${MAX_TEMPLATE_ROWS} entries`);
    }
    const types = new Map(columns.map(c => [c.name, c.type]));
    t.rows.forEach((row, i) => {
        if (row === null || typeof row !== 'object' || Array.isArray(row)) {
            fail(id, `row ${i + 1} must be an object`);
        }
        Object.keys(row).forEach(key => {
            const type = types.get(key);
            if (!type) fail(id, `row ${i + 1}: "${key}" is not a column`);
            const value = row[key];
            if (value === null || value === '') return;
            const ok =
                type === 'number'
                    ? typeof value === 'number' && Number.isFinite(value)
                    : type === 'date'
                      ? typeof value === 'string' && !isNaN(parse_utc_date(value).getTime())
                      : typeof value === 'string' && value.length <= 2000;
            if (!ok) fail(id, `row ${i + 1}: "${key}" is not a valid ${type}`);
        });
    });

    return {
        id,
        name: t.name,
        description: t.description,
        table_name: t.table_name,
        columns,
        rows: t.rows
    };
}

/** Reads and checks every `*.json` in `dir`, sorted by name. Throws on the first bad file. */
export function load_templates(dir = TEMPLATES_DIR): TableTemplate[] {
    return fs
        .readdirSync(dir)
        .filter(file => file.endsWith('.json'))
        .sort()
        .map(file => {
            const id = file.slice(0, -'.json'.length);
            let raw: unknown;
            try {
                raw = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
            } catch (ex) {
                fail(id, `is not valid JSON (${ex.message})`);
            }
            return validate_template(id, raw);
        });
}

/** The grid column documents for a new table made from the template (fields a, b, c, ...). */
export function template_column_docs(template: TableTemplate, file_id: number) {
    let field = 'a';
    return template.columns.map((col, i) => {
        if (i > 0) field = WebFileManager.prototype.get_next_column_key.call({}, field);
        return {
            file_directory_id: file_id,
            col_index: i + 1,
            field,
            order: i + 1,
            headerName: col.name,
            width: 200,
            col_type: col.type
        };
    });
}

/**
 * The template's sample rows keyed by grid field instead of column name. Values are still raw;
 * `WebFileManager.batch_create` converts them to the column types when it inserts them.
 */
export function template_row_data(
    template: TableTemplate,
    columns: { headerName: string; field: string }[]
) {
    const field_of = new Map(columns.map(c => [c.headerName, c.field]));
    return template.rows.map(row => {
        const data: Record<string, unknown> = {};
        columns.forEach(c => (data[c.field] = null));
        Object.keys(row).forEach(key => (data[field_of.get(key)] = row[key]));
        return data;
    });
}
