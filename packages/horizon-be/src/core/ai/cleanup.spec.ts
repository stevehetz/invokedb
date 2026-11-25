import { QueryColumn } from '../web-file/row-query';
import { AskError } from './ask';
import {
    CleanupProblem,
    ai_problems,
    ai_prompt,
    ai_request,
    cleanup_answer,
    find_duplicates,
    fix_email,
    is_email,
    is_phone,
    parse_delete_body,
    parse_restore_body,
    plain_number,
    read_date,
    scan_rules,
    sees_whole_rows,
    write_date
} from './cleanup';

const col = (field: string, name: string, type: QueryColumn['type'] = 'string'): QueryColumn => ({
    field,
    name,
    header_name: name,
    type
});

let next_id = 0;
const id = () => (++next_id).toString(16).padStart(24, '0');
const rows_of = (field: string, values: unknown[]) => values.map(v => ({ _id: id(), [field]: v }));

const find = (problems: CleanupProblem[], kind: string) => problems.find(p => p.kind === kind);

describe('cleanup: values', () => {
    it('tells emails', () => {
        expect(is_email('ada@example.com')).toBe(true);
        expect(is_email('ada@example')).toBe(false);
        expect(is_email('ada example.com')).toBe(false);
        expect(is_email('ada@@example.com')).toBe(false);
        expect(is_email('ada@example..com')).toBe(false);
        expect(fix_email(' mailto:Ada@Example.com. ')).toBe('Ada@Example.com');
        expect(fix_email('<ada@example.com>')).toBe('ada@example.com');
        expect(fix_email('ada @ example.com')).toBe('ada@example.com');
        expect(fix_email('not an email')).toBeNull();
    });

    it('tells phone numbers', () => {
        expect(is_phone('+1 (555) 123-4567')).toBe(true);
        expect(is_phone('555-1234 ext 12')).toBe(true);
        expect(is_phone('123')).toBe(false);
        expect(is_phone('call me')).toBe(false);
    });

    it('turns formatted numbers into plain ones', () => {
        expect(plain_number('$1,200.50')).toBe('1200.50');
        expect(plain_number('-$5')).toBe('-5');
        expect(plain_number(' 42 ')).toBe('42');
        expect(plain_number('1,2,3')).toBeNull();
        expect(plain_number('12%')).toBeNull();
        expect(plain_number('n/a')).toBeNull();
    });

    it('reads and writes dates', () => {
        expect(read_date('2024-01-05')).toMatchObject({ format: 'iso', y: 2024, a: 1, b: 5 });
        expect(read_date('03/04/2024')).toMatchObject({ format: 'slash', a: 3, b: 4 });
        expect(read_date('Jan 5th, 2024')).toMatchObject({ format: 'month_day_year', a: 1, b: 5 });
        expect(read_date('5 September 2024')).toMatchObject({
            format: 'day_month_year',
            a: 9,
            b: 5
        });
        expect(read_date('Janu 5 2024')).toBeNull();
        expect(read_date('2024-01-05 10:00')).toBeNull();
        expect(write_date({ y: 2024, m: 1, d: 5 }, 'iso')).toBe('2024-01-05');
        expect(write_date({ y: 2024, m: 1, d: 5 }, 'dmy')).toBe('05/01/2024');
        expect(write_date({ y: 2024, m: 1, d: 5 }, 'month_day_year')).toBe('Jan 5, 2024');
    });
});

describe('cleanup: the checks in code', () => {
    it('finds stray spaces, with before as stored and after fixed', () => {
        const name = col('a', 'Name');
        const rows = rows_of('a', ['Ada', ' Bob ', 'Cy  Young', null]);
        const { problems } = scan_rules(rows, [name]);
        const p = find(problems, 'whitespace');
        expect(p.count).toBe(2);
        expect(p.edit.rows).toEqual([
            { _id: rows[1]._id, before: { a: ' Bob ' }, after: { a: 'Bob' } },
            { _id: rows[2]._id, before: { a: 'Cy  Young' }, after: { a: 'Cy Young' } }
        ]);
        expect(p.examples[0]).toBe('" Bob " → "Bob"');
    });

    it('fixes the emails it can and lists the others', () => {
        const email = col('a', 'Email');
        const rows = rows_of('a', ['ada@x.com', 'mailto:bob@x.com', 'nope', ' cy@x.com ']);
        const { problems } = scan_rules(rows, [email]);
        const p = find(problems, 'email');
        expect(p.count).toBe(2);
        expect(p.fixable).toBe(1);
        expect(p.edit.rows).toEqual([
            { _id: rows[1]._id, before: { a: 'mailto:bob@x.com' }, after: { a: 'bob@x.com' } }
        ]);
        expect(p.examples).toContain('"nope"');
        // Stray spaces are their own fix, and the email check sees them fixed
        expect(find(problems, 'whitespace').edit.rows[0].after).toEqual({ a: 'cy@x.com' });
    });

    it('lists invalid phone numbers without a fix', () => {
        const phone = col('a', 'Phone');
        const { problems } = scan_rules(rows_of('a', ['555-123-4567', '12']), [phone]);
        const p = find(problems, 'phone');
        expect(p).toMatchObject({ count: 1, fixable: 0, edit: null, examples: ['"12"'] });
    });

    it('turns formatted numbers plain when most are plain', () => {
        const price = col('a', 'Price');
        const rows = rows_of('a', ['10', '12.5', '$1,200', '7', 'call us']);
        const p = find(scan_rules(rows, [price]).problems, 'number_format');
        expect(p.edit.rows).toEqual([
            { _id: rows[2]._id, before: { a: '$1,200' }, after: { a: '1200' } }
        ]);
        expect(p.count).toBe(2);
        // A column of words isn't a number column
        expect(
            find(scan_rules(rows_of('a', ['a', 'b', '$5']), [price]).problems, 'number_format')
        ).toBeUndefined();
    });

    it('writes dates the way most of the column does', () => {
        const day = col('a', 'Day');
        const rows = rows_of('a', ['2024-01-05', '2024-02-10', 'Mar 3, 2024', '25/12/2024', 'x']);
        const p = find(scan_rules(rows, [day]).problems, 'date_format');
        expect(p.edit.rows.map(r => r.after.a)).toEqual(['2024-03-03', '2024-12-25']);
        // "x" is listed as not a date
        expect(p.count).toBe(3);
    });

    it("doesn't guess slash dates that could be either way round", () => {
        const day = col('a', 'Day');
        const rows = rows_of('a', ['2024-01-05', '2024-02-10', '2024-02-11', '03/04/2024']);
        const p = find(scan_rules(rows, [day]).problems, 'date_format');
        expect(p).toBeUndefined();
    });

    it('writes a value the way most rows write it', () => {
        const status = col('a', 'Status');
        const rows = rows_of('a', ['Active', 'active', 'Active', 'ACTIVE ', 'Closed']);
        const { problems } = scan_rules(rows, [status]);
        const p = find(problems, 'case');
        expect(p.edit.rows.map(r => [r.before.a, r.after.a])).toEqual([
            ['active', 'Active'],
            ['ACTIVE ', 'Active']
        ]);
        // The spaces fix of the same cell comes first, with its own after
        expect(find(problems, 'whitespace').edit.rows[0].after.a).toBe('ACTIVE');
    });

    it('finds exact duplicates, keeping the first, and not empty rows', () => {
        const cols = [col('a', 'Name'), col('b', 'Age', 'number')];
        const rows = [
            { _id: id(), a: 'Ada', b: 36 },
            { _id: id(), a: 'Ada', b: 36 },
            { _id: id(), a: 'Ada', b: 37 },
            { _id: id(), a: '', b: null },
            { _id: id(), a: null },
            { _id: id(), a: 'Ada', b: 36 }
        ];
        expect(find_duplicates(rows, cols)).toEqual([
            { i: 1, of: 0 },
            { i: 5, of: 0 }
        ]);
        const p = find(scan_rules(rows, cols).problems, 'duplicate');
        expect(p.delete.rows).toEqual([
            { _id: rows[1]._id, before: { a: 'Ada', b: 36 }, duplicate_of: rows[0]._id },
            { _id: rows[5]._id, before: { a: 'Ada', b: 36 }, duplicate_of: rows[0]._id }
        ]);
    });

    it("checks no duplicates when the table has columns the scan doesn't see", () => {
        const cols = [col('a', 'Name'), col('b', 'Age', 'number')];
        const defs = [
            { field: 'a', headerName: 'Name' },
            { field: 'b', headerName: 'Age', col_type: 'number' }
        ];
        expect(sees_whole_rows(defs, cols)).toBe(true);
        expect(sees_whole_rows([...defs, { field: 'c', col_type: 'link' }], cols)).toBe(false);
        expect(sees_whole_rows([...defs, { field: 'd', headerName: 'Name' }], cols)).toBe(false);

        // Same Name and Age, different (unseen) link cells
        const rows = [
            { _id: id(), a: 'Ada', b: 36, c: [id()] },
            { _id: id(), a: 'Ada', b: 36, c: [id()] },
            { _id: id(), a: 'Bob', b: 40, c: null }
        ];
        const scan = scan_rules(rows, cols, false);
        expect(find(scan.problems, 'duplicate')).toBeUndefined();
        expect(scan.duplicates_checked).toBe(false);
        expect(find(scan_rules(rows, cols).problems, 'duplicate')).toBeDefined();
        // Nor are rows sent to the model for near-duplicates
        const names = ['Ada', 'Ada Lovelace', 'Bob', 'Cy'].map(a => ({ _id: id(), a }));
        const name_only = [col('a', 'Name')];
        expect(ai_request(names, name_only, scan_rules(names, name_only)).rows).toHaveLength(4);
        expect(ai_request(names, name_only, scan_rules(names, name_only, false))).toBeNull();
        expect(cleanup_answer([], 3, 3, 'none', false)).toContain("Duplicate rows weren't checked");
    });

    it('finds nothing in a clean table', () => {
        const cols = [col('a', 'Name'), col('b', 'Email')];
        const rows = [
            { _id: id(), a: 'Ada', b: 'ada@x.com' },
            { _id: id(), a: 'Bob', b: 'bob@x.com' }
        ];
        expect(scan_rules(rows, cols).problems).toEqual([]);
        expect(cleanup_answer([], 2, 2, 'none')).toBe('No problems found in 2 rows.');
    });
});

describe('cleanup: the model', () => {
    const status = col('a', 'State');
    const name = col('b', 'Name');
    const email = col('c', 'Email');
    const cols = [status, name, email];
    const states = ['CA', 'CA', 'California', 'Calif.', 'NY', 'NY', 'New York', 'CA'];
    const names = ['Ada', 'Ada L', 'Bob', 'Cy', 'Di', 'Ed', 'Flo', 'Ada'];
    const rows = states.map((s, i) => ({
        _id: id(),
        a: s,
        b: names[i],
        c: `${names[i].toLowerCase().replace(' ', '')}${i}@x.com`
    }));

    it('sends repeated values for spellings and distinct ones for near-duplicates', () => {
        const scan = scan_rules(rows, cols);
        const req = ai_request(rows, cols, scan);
        expect(req.spellings.map(s => s.column)).toEqual(['State']);
        expect(req.spellings[0].values[0]).toEqual({ value: 'CA', count: 3 });
        expect(req.duplicate_columns.map(c => c.name)).toEqual(['Name', 'Email']);
        expect(req.rows[1]).toEqual({ n: 1, cells: ['Ada L', 'adal1@x.com'] });
        const prompt = ai_prompt('people', req);
        expect(prompt).toContain('"table":"people"');
        expect(prompt).toContain('["row","Name","Email"]');
    });

    it('sends nothing when there is nothing to judge', () => {
        const one = [{ _id: id(), a: 'x' }];
        expect(ai_request(one, [status], scan_rules(one, [status]))).toBeNull();
    });

    it("keeps only the model's answers about what it was sent", () => {
        const scan = scan_rules(rows, cols);
        const req = ai_request(rows, cols, scan);
        const problems = ai_problems(
            {
                spellings: [
                    { column: 'State', canonical: 'California', variants: ['CA', 'Calif.', 'XX'] },
                    // Already in the first group
                    { column: 'State', canonical: 'NY', variants: ['Calif.', 'New York'] },
                    { column: 'Nope', canonical: 'a', variants: ['b'] },
                    { column: 'State', canonical: 'Made up', variants: ['NY'] }
                ],
                near_duplicates: [
                    { rows: [7, 0, 1], reason: 'Same person' },
                    { rows: [1, 2], reason: 'already taken' },
                    { rows: [3, 999], reason: 'not shown' },
                    { rows: ['x', 4], reason: 'bad' }
                ]
            },
            req,
            rows,
            cols,
            scan
        );
        const spelling = find(problems, 'spelling');
        expect(spelling.source).toBe('ai');
        expect(spelling.edit.rows.map(r => [r.before.a, r.after.a])).toEqual([
            ['CA', 'California'],
            ['CA', 'California'],
            ['Calif.', 'California'],
            ['New York', 'NY'],
            ['CA', 'California']
        ]);
        const near = find(problems, 'near_duplicate');
        expect(near.delete.rows.map(r => [r._id, r.duplicate_of, r.reason])).toEqual([
            [rows[1]._id, rows[0]._id, 'Same person'],
            [rows[7]._id, rows[0]._id, 'Same person']
        ]);
    });

    it('takes a broken answer as no findings', () => {
        const scan = scan_rules(rows, cols);
        const req = ai_request(rows, cols, scan);
        expect(ai_problems('nonsense', req, rows, cols, scan)).toEqual([]);
        expect(ai_problems({ spellings: 'x' }, req, rows, cols, scan)).toEqual([]);
    });
});

describe('cleanup: deleting and restoring rows', () => {
    const cols = [col('a', 'Name'), col('b', 'Age', 'number')];
    const rid = 'a'.repeat(24);

    it('checks a delete body', () => {
        expect(
            parse_delete_body({ rows: [{ _id: rid, before: { a: 'Ada', b: 36 } }] }, cols)
        ).toEqual([{ _id: rid, before: { a: 'Ada', b: 36 } }]);
        const bad = [
            undefined,
            { rows: [] },
            { rows: [{ _id: 'x', before: { a: 'Ada' } }] },
            { rows: [{ _id: rid, before: { zz: 1 } }] },
            { rows: [{ _id: rid, before: { b: 'old' } }] },
            { rows: [{ _id: rid, before: {} }] },
            {
                rows: [
                    { _id: rid, before: { a: 'x' } },
                    { _id: rid, before: { a: 'x' } }
                ]
            },
            { rows: Array.from({ length: 501 }, () => ({ _id: rid, before: { a: 'x' } })) }
        ];
        bad.forEach(body => expect(() => parse_delete_body(body, cols)).toThrow(AskError));
    });

    it('checks a restore body', () => {
        expect(parse_restore_body({ rows: [{ a: 'Ada', b: null }] }, cols)).toEqual([
            { a: 'Ada', b: null }
        ]);
        expect(() => parse_restore_body({ rows: [{ a: 1 }] }, cols)).toThrow(AskError);
        expect(() => parse_restore_body({ rows: [{ _id: rid }] }, cols)).toThrow(AskError);
        expect(() => parse_restore_body({ rows: ['x'] }, cols)).toThrow(AskError);
    });
});
