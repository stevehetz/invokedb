import {
    AI_LIMITS,
    AiError,
    ai_columns,
    batch_sizes,
    check_rows,
    check_table_design,
    check_value,
    design_columns,
    max_tokens_for,
    parse_rows_request,
    parse_table_request,
    rows_prompt,
    rows_schema,
    sample_rows,
    table_schema
} from './ai';

const COLUMNS = [
    { field: 'a', name: 'Name', type: 'string' as const },
    { field: 'b', name: 'Age', type: 'number' as const },
    { field: 'c', name: 'Joined', type: 'date' as const }
];

const message_of = (fn: () => unknown) => {
    try {
        fn();
    } catch (ex) {
        expect(ex).toBeInstanceOf(AiError);
        return ex.message;
    }
    return null;
};

describe('requests', () => {
    it('takes a prompt and a row count up to the cap', () => {
        expect(parse_rows_request({ prompt: ' 50 customers ', count: 50 })).toEqual({
            prompt: '50 customers',
            count: 50
        });
        expect(parse_rows_request({ prompt: 'x', count: '5' }).count).toBe(5);
        expect(parse_rows_request({ prompt: 'x' }).count).toBe(10);
        expect(parse_rows_request({ prompt: 'x', count: 500 }).count).toBe(500);
    });

    it('refuses a missing prompt, a long one and a bad count', () => {
        expect(message_of(() => parse_rows_request({}))).toMatch(/Describe/);
        expect(message_of(() => parse_rows_request(null))).toMatch(/Describe/);
        expect(message_of(() => parse_rows_request({ prompt: '  ' }))).toMatch(/Describe/);
        const long = 'x'.repeat(AI_LIMITS.max_prompt_length + 1);
        expect(message_of(() => parse_rows_request({ prompt: long }))).toMatch(/longer/);
        for (const count of [0, 501, 2.5, 'ten', -1, {}]) {
            expect(message_of(() => parse_rows_request({ prompt: 'x', count }))).toMatch(
                /whole number from 1 to 500/
            );
        }
    });

    it('takes a table description with 0 to 100 rows', () => {
        expect(parse_table_request({ description: 'a CRM' })).toEqual({
            description: 'a CRM',
            row_count: AI_LIMITS.default_table_rows
        });
        expect(parse_table_request({ description: 'a CRM', row_count: 0 }).row_count).toBe(0);
        expect(message_of(() => parse_table_request({ description: 'a', row_count: 101 }))).toBe(
            'The number of rows must be a whole number from 0 to 100'
        );
        expect(message_of(() => parse_table_request({}))).toMatch(/Describe the table/);
    });
});

describe('columns and schemas', () => {
    it('leaves out deleted and link columns, in column order', () => {
        const cols = ai_columns([
            { field: 'b', headerName: 'Age', col_type: 'number', order: 2 },
            { field: 'a', headerName: 'Name', order: 1 },
            { field: 'c', headerName: 'Gone', deleted: true, order: 3 },
            { field: 'd', headerName: 'Owner', col_type: 'link', order: 4 }
        ]);
        expect(cols).toEqual([
            { field: 'a', name: 'Name', type: 'string' },
            { field: 'b', name: 'Age', type: 'number' }
        ]);
    });

    it('builds a strict rows schema keyed by field', () => {
        const schema: any = rows_schema(COLUMNS);
        const item = schema.properties.rows.items;
        expect(item.required).toEqual(['a', 'b', 'c']);
        expect(item.additionalProperties).toBe(false);
        expect(item.properties.b.anyOf).toEqual([{ type: 'number' }, { type: 'null' }]);
        expect(item.properties.c.anyOf[0]).toEqual({ type: 'string', format: 'date' });
        expect(item.properties.a.description).toBe('Name (text)');
        expect(schema.additionalProperties).toBe(false);
    });

    it('builds a table design schema with the three column types', () => {
        const schema: any = table_schema();
        expect(schema.properties.columns.items.properties.type.enum).toEqual([
            'string',
            'number',
            'date'
        ]);
    });
});

describe('checking the model output', () => {
    it('converts values to the column types or null', () => {
        expect(check_value(12, 'number')).toBe(12);
        expect(check_value('12.5', 'number')).toBe(12.5);
        expect(check_value('abc', 'number')).toBeNull();
        expect(check_value(Infinity, 'number')).toBeNull();
        expect(check_value('2026-02-03', 'date')).toBe('2026-02-03');
        expect(check_value('2026-02-03T10:00:00Z', 'date')).toBe('2026-02-03');
        expect(check_value('2026-02-31', 'date')).toBeNull();
        expect(check_value(5, 'date')).toBeNull();
        expect(check_value(' hi ', 'string')).toBe('hi');
        expect(check_value(7, 'string')).toBe('7');
        expect(check_value({ x: 1 }, 'string')).toBeNull();
        expect(check_value('x'.repeat(3000), 'string')).toHaveLength(AI_LIMITS.max_string_length);
    });

    it('keeps only the columns, fills missing ones, drops empty rows and caps the count', () => {
        const raw = {
            rows: [
                { a: 'Ada', b: '36', c: '2026-01-02', extra: 'x', _id: 'y' },
                { a: 'Bram' },
                { a: null, b: null, c: null },
                'not a row',
                [1, 2],
                { a: 'Cleo', b: 'old', c: 'yesterday' },
                { a: 'Dev' }
            ]
        };
        expect(check_rows(COLUMNS, raw, 3)).toEqual([
            { a: 'Ada', b: 36, c: '2026-01-02' },
            { a: 'Bram', b: null, c: null },
            { a: 'Cleo', b: null, c: null }
        ]);
        expect(check_rows(COLUMNS, raw, 10, c => c.name)[0]).toEqual({
            Name: 'Ada',
            Age: 36,
            Joined: '2026-01-02'
        });
        expect(check_rows(COLUMNS, null, 10)).toEqual([]);
        expect(check_rows(COLUMNS, { rows: 'x' }, 10)).toEqual([]);
    });

    it('sends at most a few example rows, shortened', () => {
        const docs = Array.from({ length: 9 }, (_, i) => ({
            _id: `id${i}`,
            a: 'y'.repeat(500),
            b: i,
            c: new Date(Date.UTC(2026, 0, i + 1)),
            secret_field: 'not a column'
        }));
        const samples = sample_rows(COLUMNS, docs);
        expect(samples).toHaveLength(AI_LIMITS.sample_rows);
        expect(samples[1]).toEqual({ a: 'y'.repeat(200), b: 1, c: '2026-01-02' });
        expect(sample_rows(COLUMNS, null)).toEqual([]);
    });
});

describe('table designs', () => {
    it('makes names the app accepts', () => {
        const design = check_table_design({
            table_name: 'Dog Groomer CRM!',
            columns: [
                { name: 'Pet name', type: 'string' },
                { name: 'Pet name', type: 'string' },
                { name: 'Weight (kg)', type: 'number' },
                { name: 'Row', type: 'string' },
                { name: 'Next visit', type: 'date' },
                { name: '???', type: 'string' },
                { name: 'Notes', type: 'boolean' },
                null
            ]
        });
        expect(design.table_name).toBe('dog_groomer_crm');
        expect(design.columns).toEqual([
            { name: 'Pet name', type: 'string' },
            { name: 'Pet name 2', type: 'string' },
            { name: 'Weight kg', type: 'number' },
            { name: 'Row value', type: 'string' },
            { name: 'Next visit', type: 'date' },
            { name: 'Notes', type: 'string' }
        ]);
    });

    it('falls back to a default name and caps the columns', () => {
        const columns = Array.from({ length: 40 }, (_, i) => ({ name: `c${i}`, type: 'string' }));
        const design = check_table_design({ table_name: '!!!', columns });
        expect(design.table_name).toBe('new_table');
        expect(design.columns).toHaveLength(AI_LIMITS.max_table_columns);
    });

    it('refuses a design with no usable column', () => {
        expect(message_of(() => check_table_design({ table_name: 'x', columns: [] }))).toMatch(
            /columns/
        );
        expect(message_of(() => check_table_design(null))).toMatch(/columns/);
    });

    it('gives a new table the grid fields a, b, c', () => {
        expect(
            design_columns([
                { name: 'A', type: 'string' },
                { name: 'B', type: 'number' }
            ])
        ).toEqual([
            { field: 'a', name: 'A', type: 'string' },
            { field: 'b', name: 'B', type: 'number' }
        ]);
    });
});

describe('model calls', () => {
    it('splits a big request into calls of at most rows_per_call', () => {
        expect(batch_sizes(1)).toEqual([1]);
        expect(batch_sizes(60, 25)).toEqual([25, 25, 10]);
        const sizes = batch_sizes(AI_LIMITS.max_rows_per_request);
        expect(sizes.reduce((a, b) => a + b, 0)).toBe(AI_LIMITS.max_rows_per_request);
        // The biggest request is one round of parallel calls
        expect(sizes.length).toBeLessThanOrEqual(AI_LIMITS.parallel_calls);
    });

    it('puts the request inside tags, after the columns and examples', () => {
        const prompt = rows_prompt(COLUMNS, [{ a: 'Ada', b: 1, c: null }], 'customers', 5, {
            index: 1,
            of: 3
        });
        expect(prompt).toContain('- b: Age, number');
        expect(prompt).toContain('{"a":"Ada","b":1,"c":null}');
        expect(prompt).toContain('<request>\ncustomers\n</request>');
        expect(prompt).toContain('Generate exactly 5 new rows.');
        expect(prompt).toContain('part 2 of 3');
        expect(rows_prompt(COLUMNS, [], 'x', 1)).not.toContain('Existing rows');
    });

    it('asks for enough output tokens, within bounds', () => {
        expect(max_tokens_for(1, 1)).toBe(1024);
        expect(max_tokens_for(25, 10)).toBeGreaterThan(25 * 10 * 20);
        expect(max_tokens_for(1000, 52)).toBe(32000);
    });
});
