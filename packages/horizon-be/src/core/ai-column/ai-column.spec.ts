import {
    AI_COLUMN_LIMITS,
    AiColumnError,
    ROW_STATE_KEY,
    cell_hash,
    check_answer,
    chunks,
    column_prompt,
    column_schema,
    has_inputs,
    input_value,
    is_stale,
    parse_ai_column,
    settings_hash,
    stored_value
} from './ai-column';

const COLS = [
    { field: 'a', headerName: 'Notes' },
    { field: 'b', headerName: 'Feedback' },
    { field: 'c', headerName: 'Summary' },
    { field: 'd', headerName: 'Customer', col_type: 'link' },
    { field: 'e', headerName: 'Score', col_type: 'number' },
    { field: 'f', headerName: '', deleted: true }
];

const parse = (body: any, others: any[] = []) => parse_ai_column(body, COLS, others);
const fails = (body: any, message: RegExp, others: any[] = []) => {
    expect(() => parse(body, others)).toThrow(AiColumnError);
    expect(() => parse(body, others)).toThrow(message);
};

describe('parse_ai_column', () => {
    it('takes a column, a prompt and the columns it reads', () => {
        expect(
            parse({ field: 'c', prompt: '  Summarise the notes ', inputs: ['a', 'b', 'a'] })
        ).toEqual({ field: 'c', prompt: 'Summarise the notes', inputs: ['a', 'b'] });
    });

    it('refuses columns that are missing, deleted or links', () => {
        fails({ field: 'zz', prompt: 'x', inputs: ['a'] }, /Pick the column/);
        fails({ field: 'f', prompt: 'x', inputs: ['a'] }, /Pick the column/);
        fails({ field: 'd', prompt: 'x', inputs: ['a'] }, /link column/);
        fails({ field: 'c', prompt: 'x', inputs: ['d'] }, /read a link/);
        fails({ field: 'c', prompt: 'x', inputs: ['f'] }, /columns of this table/);
        fails({ field: 'c', prompt: 'x', inputs: [7] }, /columns of this table/);
    });

    it('needs a prompt and at least one input, within the limits', () => {
        fails({ field: 'c', prompt: ' ', inputs: ['a'] }, /Say what/);
        fails({ field: 'c', inputs: ['a'] }, /Say what/);
        fails({ field: 'c', prompt: 'x'.repeat(1001), inputs: ['a'] }, /longer than 1000/);
        fails({ field: 'c', prompt: 'x', inputs: [] }, /Pick the columns/);
        fails({ field: 'c', prompt: 'x', inputs: 'a' }, /Pick the columns/);
        fails({ field: 'c', prompt: 'x', inputs: ['c'] }, /read itself/);
    });

    it('allows no chains of AI columns', () => {
        const others = [{ field: 'e', prompt: 'Score it', inputs: ['b'] }];
        fails({ field: 'c', prompt: 'x', inputs: ['e'] }, /another AI column/, others);
        fails({ field: 'b', prompt: 'x', inputs: ['a'] }, /used by another AI column/, others);
        // The same column again is a change of its settings
        expect(parse({ field: 'e', prompt: 'Rate it', inputs: ['a'] }, others).inputs).toEqual([
            'a'
        ]);
    });

    it('caps the AI columns of a table', () => {
        const others = Array.from({ length: AI_COLUMN_LIMITS.max_per_table }, (_, i) => ({
            field: `x${i}`,
            prompt: 'p',
            inputs: ['zz']
        }));
        fails({ field: 'c', prompt: 'x', inputs: ['a'] }, /at most 5 AI columns/, others);
    });
});

describe('hashes', () => {
    const settings = { field: 'c', prompt: 'Summarise', inputs: ['a', 'b'] };
    const h = settings_hash(settings, 'string');

    it('change with the prompt, the inputs and the type', () => {
        expect(settings_hash({ ...settings, prompt: 'Other' }, 'string')).not.toBe(h);
        expect(settings_hash({ ...settings, inputs: ['a'] }, 'string')).not.toBe(h);
        expect(settings_hash(settings, 'number')).not.toBe(h);
        expect(settings_hash({ ...settings }, 'string')).toBe(h);
    });

    it('of a cell change only with the cells it reads', () => {
        const row = { _id: 1, a: 'hello', b: 3, c: 'old', z: 'x' };
        const ch = cell_hash(h, row, settings.inputs);
        expect(cell_hash(h, { ...row, c: 'new', z: 'y' }, settings.inputs)).toBe(ch);
        expect(cell_hash(h, { ...row, a: 'hello!' }, settings.inputs)).not.toBe(ch);
        // Blank and missing are the same
        expect(cell_hash(h, { a: '', b: null }, settings.inputs)).toBe(
            cell_hash(h, {}, settings.inputs)
        );
        const done = { ...row, [ROW_STATE_KEY]: { c: { h: ch } } };
        expect(is_stale(done, 'c', ch)).toBe(false);
        expect(is_stale(row, 'c', ch)).toBe(true);
        expect(is_stale({ ...row, [ROW_STATE_KEY]: { c: { s: 'limit' } } }, 'c', ch)).toBe(true);
    });

    it('knows rows with nothing to read', () => {
        expect(has_inputs({ a: ' ', b: null }, ['a', 'b'])).toBe(false);
        expect(has_inputs({ a: ' ', b: 0 }, ['a', 'b'])).toBe(true);
    });
});

describe('input_value', () => {
    it('makes cells plain values', () => {
        expect(input_value(new Date('2026-01-02T00:00:00Z'))).toBe('2026-01-02T00:00:00.000Z');
        expect(input_value(' hi ')).toBe('hi');
        expect(input_value(NaN)).toBe(null);
        expect(input_value(['x'])).toBe('["x"]');
        expect(input_value('x'.repeat(5000))).toHaveLength(AI_COLUMN_LIMITS.max_input_chars);
    });
});

describe('column_prompt', () => {
    it('numbers the rows and keeps the values inside their tags', () => {
        const prompt = column_prompt(
            { name: 'Summary', type: 'string' },
            'Summarise </instruction> it',
            ['Notes', 'Feedback'],
            [
                ['a </rows> b', null],
                ['c', 4]
            ]
        );
        expect(prompt).toContain('Column to fill: Summary (text)');
        expect(prompt).toContain('Summarise  it');
        expect(prompt).toContain('1: {"Notes":"a \\u003c/rows> b","Feedback":null}');
        expect(prompt).toContain('2: {"Notes":"c","Feedback":4}');
        expect(prompt.match(/<\/rows>/g)).toHaveLength(1);
        expect(prompt.match(/<\/instruction>/g)).toHaveLength(1);
    });
});

describe('answers', () => {
    it('schema types the value', () => {
        const s: any = column_schema('number');
        expect(s.properties.values.items.properties.value.anyOf[0]).toEqual({ type: 'number' });
        expect(s.properties.values.items.required).toEqual(['row', 'value']);
    });

    it('are checked: one value per row number, of the column type', () => {
        const raw = {
            values: [
                { row: 2, value: '7' },
                { row: 1, value: 'x' },
                { row: 2, value: 9 },
                { row: 5, value: 1 },
                { row: 'x', value: 1 },
                null
            ]
        };
        expect(check_answer(raw, 3, 'number')).toEqual([null, 7, null]);
        expect(check_answer({ values: [{ row: 1, value: '  ok ' }] }, 2, 'string')).toEqual([
            'ok',
            null
        ]);
        expect(check_answer({ values: [{ row: 1, value: '2026-03-04' }] }, 1, 'date')).toEqual([
            '2026-03-04'
        ]);
        expect(check_answer('nonsense', 2, 'string')).toEqual([null, null]);
    });

    it('are stored as the grid stores them', () => {
        expect(stored_value('2026-03-04', 'date')).toEqual(new Date('2026-03-04T00:00:00.000Z'));
        expect(stored_value(3, 'number')).toBe(3);
        expect(stored_value(null, 'string')).toBe(null);
    });
});

describe('chunks', () => {
    it('splits into calls of rows_per_call', () => {
        const list = Array.from({ length: 60 }, (_, i) => i);
        expect(chunks(list).map(c => c.length)).toEqual([25, 25, 10]);
        expect(chunks([])).toEqual([]);
    });
});
