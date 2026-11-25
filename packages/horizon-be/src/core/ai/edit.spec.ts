import { AskError, ask_columns } from './ask';
import {
    EDIT_MAX_CHANGES,
    EDIT_MAX_ROWS,
    EDIT_TOOL_NAME,
    date_text,
    edit_answer,
    edit_row,
    edit_tool,
    parse_apply_body,
    parse_edit_input,
    row_unchanged_since,
    same_value
} from './edit';

const COLUMNS = ask_columns([
    { field: 'a', headerName: 'Name' },
    { field: 'b', headerName: 'Price', col_type: 'number' },
    { field: 'c', headerName: 'Added', col_type: 'date' },
    { field: 'd', headerName: 'City' },
    { field: 'e', headerName: 'State' },
    { field: 'f', headerName: 'First' },
    { field: 'g', headerName: 'Last' },
    { field: 'h', headerName: 'Supplier', col_type: 'link', link_table_id: 5 }
]);
const ID = '0123456789abcdef01234567';

function edit(changes: any[], row: any, extra: any = {}) {
    const spec = parse_edit_input({ changes, ...extra }, COLUMNS);
    return edit_row(spec.changes, { _id: ID, ...row });
}

function refused(input: any, message?: RegExp) {
    let error: any = null;
    try {
        parse_edit_input(input, COLUMNS);
    } catch (ex) {
        error = ex;
    }
    expect(error).toBeInstanceOf(AskError);
    if (message) expect(error.message).toMatch(message);
}

describe('edit_tool', () => {
    it('names the columns an edit can change, not link columns', () => {
        const tool = edit_tool(COLUMNS);
        expect(tool.name).toBe(EDIT_TOOL_NAME);
        const change = tool.input_schema.properties.changes.items.properties;
        expect(change.column.enum).toEqual([
            'Name',
            'Price',
            'Added',
            'City',
            'State',
            'First',
            'Last'
        ]);
        expect(change.op.enum).toContain('title');
        expect(tool.input_schema.properties.changes.maxItems).toBe(EDIT_MAX_CHANGES);
    });
});

describe('parse_edit_input', () => {
    it('turns the filters into a query of at most EDIT_MAX_ROWS rows', () => {
        const spec = parse_edit_input(
            {
                summary: 'Title-case the names.',
                filters: [{ column: 'Price', op: 'gt', value: 10 }],
                changes: [{ column: 'Name', op: 'title' }]
            },
            COLUMNS
        );
        expect(spec.summary).toBe('Title-case the names.');
        expect(spec.query.limit).toBe(EDIT_MAX_ROWS);
        expect(spec.query.filter).toEqual({ $and: [{ b: { $gt: 10 } }] });
        expect(spec.count_query.filter).toEqual({ $and: [{ b: { $gt: 10 } }] });
        expect(spec.changes[0]).toMatchObject({ op: 'title', column: { field: 'a' } });
        expect(spec.changes[0].from.field).toBe('a');
    });

    it('edits every row without filters', () => {
        const spec = parse_edit_input({ changes: [{ column: 'Name', op: 'upper' }] }, COLUMNS);
        expect(spec.query.filter).toEqual({});
    });

    it('refuses anything that is not a known change of a known column', () => {
        refused(null);
        refused({}, /changes/);
        refused({ changes: [] }, /changes/);
        refused({ changes: [{ column: 'Name', op: 'eval', value: 'x' }] }, /op must be/);
        refused({ changes: [{ column: 'password', op: 'clear' }] }, /unknown column/);
        refused({ changes: [{ column: 'Supplier', op: 'clear' }] }, /unknown column/);
        refused({ changes: [{ column: '_id', op: 'clear' }] }, /unknown column/);
        refused({ changes: [{ column: 'Name', op: 'upper', value: 'x' }] }, /doesn't take/);
        refused({ changes: [{ column: 'Name', op: 'set' }] }, /value is required/);
        refused({ changes: [{ column: 'Name', op: 'set', value: { $set: 1 } }] }, /text/);
        refused({ changes: [{ column: 'Price', op: 'set', value: '12' }] }, /number/);
        refused({ changes: [{ column: 'Added', op: 'set', value: 'soon' }] }, /date/);
        refused({ changes: [{ column: 'Price', op: 'upper' }] }, /text columns/);
        refused({ changes: [{ column: 'Name', op: 'add', value: 1 }] }, /number columns/);
        refused({ changes: [{ column: 'Name', op: 'replace', find: '' }] }, /find/);
        refused({ changes: [{ column: 'Name', op: 'split', separator: ' ', part: 1.5 }] });
        refused({ changes: [{ column: 'State', op: 'map', values: {} }] }, /values/);
        refused({ changes: [{ column: 'Name', op: 'concat', parts: [{ code: 'x' }] }] });
        refused({ changes: [{ column: 'Price', op: 'round', decimals: 11 }] });
        refused(
            {
                changes: [
                    { column: 'Name', op: 'upper' },
                    { column: 'Name', op: 'lower' }
                ]
            },
            /twice/
        );
        refused({ changes: [{ column: 'Name', op: 'upper' }], update: { a: 1 } }, /Unknown key/);
        refused({
            changes: [{ column: 'Name', op: 'upper' }],
            filters: [{ column: 'Name', op: '$where', value: 'sleep(1)' }]
        });
        refused({
            changes: Array.from({ length: EDIT_MAX_CHANGES + 1 }, () => ({
                column: 'Name',
                op: 'upper'
            }))
        });
    });
});

describe('edit_row', () => {
    it('title-cases, upper- and lower-cases and trims text', () => {
        expect(edit([{ column: 'Name', op: 'title' }], { a: "mARY o'neil-SMITH" })).toEqual({
            _id: ID,
            before: { a: "mARY o'neil-SMITH" },
            after: { a: "Mary O'neil-Smith" }
        });
        expect(edit([{ column: 'Name', op: 'upper' }], { a: 'pen' }).after).toEqual({ a: 'PEN' });
        expect(edit([{ column: 'Name', op: 'lower' }], { a: 'PEN' }).after).toEqual({ a: 'pen' });
        expect(edit([{ column: 'Name', op: 'trim' }], { a: '  a   b ' }).after).toEqual({
            a: 'a b'
        });
    });

    it('leaves out rows and cells it does not change', () => {
        expect(edit([{ column: 'Name', op: 'title' }], { a: 'Pen' })).toBeNull();
        expect(edit([{ column: 'Name', op: 'upper' }], { a: null })).toBeNull();
        const res = edit(
            [
                { column: 'Name', op: 'upper' },
                { column: 'City', op: 'upper' }
            ],
            { a: 'PEN', d: 'boston' }
        );
        expect(res.before).toEqual({ d: 'boston' });
        expect(res.after).toEqual({ d: 'BOSTON' });
    });

    it('splits a column into two, each reading the row as it was', () => {
        const res = edit(
            [
                { column: 'First', op: 'split', from: 'Name', separator: ' ', part: 0 },
                { column: 'Last', op: 'split', from: 'Name', separator: ' ', part: -1 },
                { column: 'Name', op: 'clear' }
            ],
            { a: 'Ada  King Lovelace', f: null, g: null }
        );
        expect(res.after).toEqual({ f: 'Ada', g: 'Lovelace', a: null });
        // A part that isn't there is empty
        expect(
            edit([{ column: 'Last', op: 'split', from: 'Name', separator: ' ', part: 2 }], {
                a: 'Cher',
                g: 'x'
            }).after
        ).toEqual({ g: null });
    });

    it('fills from a map and leaves values not in it', () => {
        const changes = [
            { column: 'State', op: 'map', from: 'City', values: { Boston: 'MA', Austin: 'TX' } }
        ];
        expect(edit(changes, { d: ' Boston ', e: null }).after).toEqual({ e: 'MA' });
        expect(edit(changes, { d: 'Paris', e: null })).toBeNull();
    });

    it('sets, clears, copies, replaces and joins', () => {
        expect(edit([{ column: 'City', op: 'set', value: 'Rome' }], { d: null }).after).toEqual({
            d: 'Rome'
        });
        expect(edit([{ column: 'City', op: 'clear' }], { d: 'Rome' }).after).toEqual({ d: null });
        expect(edit([{ column: 'City', op: 'copy', from: 'Price' }], { b: 12 }).after).toEqual({
            d: '12'
        });
        // Text that isn't a number isn't copied into a number column
        expect(edit([{ column: 'Price', op: 'copy', from: 'City' }], { d: 'x', b: 1 })).toBeNull();
        expect(
            edit([{ column: 'Name', op: 'replace', find: 'St.', replace_with: 'Street' }], {
                a: '1 Main St. (St.)'
            }).after
        ).toEqual({ a: '1 Main Street (Street)' });
        expect(
            edit(
                [
                    {
                        column: 'Name',
                        op: 'concat',
                        parts: [{ column: 'First' }, { text: ' ' }, { column: 'Last' }]
                    }
                ],
                { a: null, f: 'Ada', g: null }
            ).after
        ).toEqual({ a: 'Ada' });
    });

    it('does number arithmetic without float noise', () => {
        expect(edit([{ column: 'Price', op: 'add', value: 0.2 }], { b: 0.1 }).after).toEqual({
            b: 0.3
        });
        expect(edit([{ column: 'Price', op: 'multiply', value: 1.1 }], { b: 10 }).after).toEqual({
            b: 11
        });
        expect(edit([{ column: 'Price', op: 'round', decimals: 1 }], { b: 2.345 }).after).toEqual({
            b: 2.3
        });
        expect(edit([{ column: 'Price', op: 'add', value: 1 }], { b: null })).toBeNull();
    });

    it('sets dates in the grid format and compares them as dates', () => {
        const res = edit([{ column: 'Added', op: 'set', value: '2024-01-15' }], {
            c: '2020-01-02 12:00:00 AM'
        });
        expect(res.after).toEqual({ c: '2024-01-15 12:00:00 AM' });
        expect(
            edit([{ column: 'Added', op: 'set', value: '2024-01-15' }], {
                c: '2024-01-15 12:00:00 AM'
            })
        ).toBeNull();
    });
});

describe('edit_answer', () => {
    it('says what changes, and when the filter matches more than an edit changes', () => {
        expect(edit_answer('Title-case names.', 3, 2)).toBe(
            'Title-case names. This changes 2 rows. Check them below, then Apply.'
        );
        expect(edit_answer('', 0, 0)).toContain('No rows match');
        expect(edit_answer('', 4, 0)).toContain('None of the 4 rows would change');
        expect(edit_answer('', 900, EDIT_MAX_ROWS)).toContain(`at most ${EDIT_MAX_ROWS}`);
    });
});

describe('parse_apply_body', () => {
    const ok = { _id: ID, before: { a: 'pen', b: 1 }, after: { a: 'Pen', b: null } };

    it('accepts rows with the same columns before and after', () => {
        expect(parse_apply_body({ rows: [ok] }, COLUMNS)).toEqual([ok]);
    });

    it('accepts long text, which stored cells can hold (and undo writes back)', () => {
        const long = 'x'.repeat(5000);
        const rows = [
            { _id: ID, before: { a: long }, after: { a: null } },
            { _id: '0123456789abcdef0123456f', before: { a: null }, after: { a: long } }
        ];
        expect(parse_apply_body({ rows }, COLUMNS)).toEqual(rows);
    });

    it('refuses anything else', () => {
        const bad = [
            undefined,
            [],
            { rows: [] },
            { rows: [{ ...ok, _id: 'x' }] },
            { rows: [ok, ok] },
            { rows: [{ ...ok, after: { a: 'Pen' } }] },
            { rows: [{ ...ok, before: { a: 'pen', c: 1 } }] },
            { rows: [{ _id: ID, before: { h: null }, after: { h: ['x'] } }] },
            { rows: [{ _id: ID, before: { zz: 1 }, after: { zz: 2 } }] },
            { rows: [{ ...ok, after: { a: 'Pen', b: '2' } }] },
            { rows: [{ ...ok, after: { a: { $set: 1 }, b: 1 } }] },
            { rows: [{ _id: ID, before: { c: null }, after: { c: 'soon' } }] },
            { rows: Array.from({ length: EDIT_MAX_ROWS + 1 }, () => ok) }
        ];
        bad.forEach(body => expect(() => parse_apply_body(body, COLUMNS)).toThrow(AskError));
    });
});

describe('row_unchanged_since', () => {
    it('compares the cells the edit changes', () => {
        const row = { a: 'pen', b: 2, c: '2024-01-15 12:00:00 AM', d: 'Rome' };
        expect(row_unchanged_since(row, { a: 'pen', b: 2 }, COLUMNS)).toBe(true);
        expect(row_unchanged_since(row, { c: '2024-01-15' }, COLUMNS)).toBe(true);
        expect(row_unchanged_since(row, { a: 'Pen' }, COLUMNS)).toBe(false);
        expect(row_unchanged_since({ a: '' }, { a: null }, COLUMNS)).toBe(true);
    });

    it('treats empty text and null as the same', () => {
        expect(same_value('string', '', null)).toBe(true);
        expect(same_value('number', 0, null)).toBe(false);
        expect(date_text('nope')).toBeNull();
    });
});
