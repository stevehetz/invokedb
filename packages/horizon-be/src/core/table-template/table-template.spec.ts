import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    TEMPLATES_DIR,
    load_templates,
    template_column_docs,
    template_row_data,
    validate_template
} from './table-template';

const valid = () => ({
    name: 'Things',
    description: 'A list of things',
    table_name: 'things',
    columns: [
        { name: 'Name', type: 'string' },
        { name: 'Count', type: 'number' },
        { name: 'Added', type: 'date' }
    ],
    rows: [{ Name: 'cup', Count: 3, Added: '2026-01-02' }, { Name: 'pen' }]
});

describe('table templates in the repo', () => {
    const files = fs.readdirSync(TEMPLATES_DIR).filter(f => f.endsWith('.json'));

    it('has at least four', () => {
        expect(files.length).toBeGreaterThanOrEqual(4);
    });

    it.each(files)('%s is a valid template with columns and sample rows', file => {
        const raw = JSON.parse(fs.readFileSync(path.join(TEMPLATES_DIR, file), 'utf8'));
        const template = validate_template(file.replace(/\.json$/, ''), raw);
        expect(template.columns.length).toBeGreaterThan(0);
        expect(template.rows.length).toBeGreaterThan(0);
    });

    it('all load, with unique names', () => {
        const templates = load_templates();
        expect(templates.map(t => t.id)).toEqual(files.map(f => f.replace(/\.json$/, '')).sort());
        expect(new Set(templates.map(t => t.name)).size).toBe(templates.length);
    });
});

describe('validate_template', () => {
    it('accepts a valid template', () => {
        const t = validate_template('things', valid());
        expect(t.id).toBe('things');
        expect(t.columns.map(c => c.type)).toEqual(['string', 'number', 'date']);
    });

    it('rejects a bad file name', () => {
        expect(() => validate_template('Bad Name', valid())).toThrow(/file name/);
    });

    it('rejects a non-object', () => {
        expect(() => validate_template('x', [])).toThrow(/JSON object/);
        expect(() => validate_template('x', null)).toThrow(/JSON object/);
    });

    it('rejects a missing name or a bad table name', () => {
        expect(() => validate_template('x', { ...valid(), name: '' })).toThrow(/"name"/);
        expect(() => validate_template('x', { ...valid(), table_name: 'my table' })).toThrow(
            /"table_name"/
        );
    });

    it('rejects missing, duplicate, reserved or untyped columns', () => {
        expect(() => validate_template('x', { ...valid(), columns: [] })).toThrow(/"columns"/);
        const dup = valid();
        dup.columns.push({ name: 'Name', type: 'string' });
        expect(() => validate_template('x', dup)).toThrow(/Duplicate column name/);
        const reserved = valid();
        reserved.columns[0].name = 'row_num';
        expect(() => validate_template('x', reserved)).toThrow(/reserved column name/);
        const untyped = valid();
        untyped.columns[1].type = 'boolean';
        expect(() => validate_template('x', untyped)).toThrow(/"type" must be one of/);
    });

    it('rejects rows with unknown columns or values of the wrong type', () => {
        const unknown = valid();
        (unknown.rows[0] as any).Colour = 'red';
        expect(() => validate_template('x', unknown)).toThrow(/"Colour" is not a column/);
        const bad_number = valid();
        (bad_number.rows[0] as any).Count = '3';
        expect(() => validate_template('x', bad_number)).toThrow(/not a valid number/);
        const bad_date = valid();
        bad_date.rows[0].Added = 'someday';
        expect(() => validate_template('x', bad_date)).toThrow(/not a valid date/);
    });

    it('rejects more than 100 rows', () => {
        const many = valid();
        many.rows = Array.from({ length: 101 }, () => ({ Name: 'x' }));
        expect(() => validate_template('x', many)).toThrow(/at most 100/);
    });
});

describe('load_templates', () => {
    it('names the bad file', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'templates-'));
        try {
            fs.writeFileSync(path.join(dir, 'good.json'), JSON.stringify(valid()));
            fs.writeFileSync(path.join(dir, 'broken.json'), '{ not json');
            expect(() => load_templates(dir)).toThrow(/"broken": is not valid JSON/);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
});

describe('template_column_docs / template_row_data', () => {
    it('maps columns to grid fields and rows to those fields', () => {
        const t = validate_template('things', valid());
        const cols = template_column_docs(t, 7);
        expect(cols.map(c => [c.field, c.headerName, c.col_type, c.col_index])).toEqual([
            ['a', 'Name', 'string', 1],
            ['b', 'Count', 'number', 2],
            ['c', 'Added', 'date', 3]
        ]);
        expect(cols.every(c => c.file_directory_id === 7)).toBe(true);
        expect(template_row_data(t, cols)).toEqual([
            { a: 'cup', b: 3, c: '2026-01-02' },
            { a: 'pen', b: null, c: null }
        ]);
    });

    it('goes past z the way the grid does', () => {
        const t = validate_template('wide', {
            ...valid(),
            columns: Array.from({ length: 28 }, (_, i) => ({ name: `c${i}`, type: 'string' })),
            rows: []
        });
        const fields = template_column_docs(t, 1).map(c => c.field);
        expect(fields.slice(24)).toEqual(['y', 'z', 'a0', 'b0']);
    });
});
