import {
    EXPORT_LIMITS,
    csv_cell,
    csv_chunks,
    csv_line,
    export_columns,
    export_file_name,
    export_row,
    export_value,
    export_view,
    form_settings,
    is_downloadable,
    is_export_id,
    json_chunks,
    manifest,
    new_export,
    safe_name,
    table_paths,
    view_settings,
    webhook_settings
} from './account-export';

async function collect(chunks: AsyncIterable<string>) {
    let s = '';
    for await (const c of chunks) s += c;
    return s;
}

async function* from(rows: any[]) {
    for (const r of rows) yield r;
}

const COLS = [
    { field: 'b', headerName: 'Age', col_type: 'number', order: 2 },
    { field: 'a', headerName: 'Name', order: 1 },
    { field: 'c', headerName: 'Born', col_type: 'date', order: 3 },
    { field: 'd', headerName: 'Team', col_type: 'link', link_table_id: 5, order: 4 },
    { field: 'e', headerName: '', order: 5 },
    { field: 'f', headerName: 'Old', deleted: true, order: 6 }
];
const NAMES = new Map([[5, 'teams']]);

describe('account export ids and records', () => {
    it('makes and checks ids, and refuses anything else as a file name', () => {
        const e = new_export(3, 1000);
        expect(is_export_id(e.id)).toBe(true);
        expect(export_file_name(e.id)).toBe(`${e.id}.zip`);
        expect(is_export_id('../../etc/passwd')).toBe(false);
        expect(() => export_file_name('../x')).toThrow();
        expect(e).toMatchObject({ account_id: 3, status: 'pending', created_at: 1000 });
    });

    it('works for 24 hours once ready, then shows as expired', () => {
        const e = { ...new_export(3, 0), status: 'ready' as const, expires_at: 100 };
        expect(EXPORT_LIMITS.keep_ms).toBe(24 * 3600 * 1000);
        expect(is_downloadable(e, 99)).toBe(true);
        expect(is_downloadable(e, 100)).toBe(false);
        expect(export_view(e, 99).status).toBe('ready');
        expect(export_view(e, 100).status).toBe('expired');
        expect(export_view(null, 0)).toBeNull();
        expect(export_view(e, 0)).not.toHaveProperty('account_id');
        expect(is_downloadable({ ...e, status: 'running' }, 0)).toBe(false);
    });
});

describe('paths in the zip', () => {
    it('makes names safe', () => {
        expect(safe_name('a/b\\c:d*?"<>|')).toBe('a_b_c_d______');
        expect(safe_name('..secret')).toBe('_secret');
        expect(safe_name('  ')).toBe('untitled');
        expect(safe_name(null)).toBe('untitled');
        expect(safe_name('x'.repeat(300))).toHaveLength(EXPORT_LIMITS.max_name_length);
    });

    it('puts tables under their folders and numbers clashes', () => {
        const paths = table_paths([
            { id: 1, name: 'Sales', type: 'dir', parent_id: null },
            { id: 2, name: 'Orders', type: 'file', parent_id: 1 },
            { id: 3, name: 'orders', type: 'file', parent_id: 1 },
            { id: 4, name: 'Orders', type: 'file', parent_id: null },
            { id: 6, name: 'Q/1', type: 'dir', parent_id: 1 },
            { id: 7, name: 'Leads', type: 'file', parent_id: 6 },
            { id: 8, name: 'Lost', type: 'file', parent_id: 99 }
        ]);
        expect(paths.map(p => p.path)).toEqual([
            'tables/Sales/Orders',
            'tables/Sales/orders (2)',
            'tables/Orders',
            'tables/Sales/Q_1/Leads',
            'tables/Lost'
        ]);
        expect(paths[3]).toMatchObject({ id: 7, name: 'Leads', folders: ['Sales', 'Q/1'] });
    });

    it("doesn't loop on a folder that is its own parent", () => {
        const paths = table_paths([
            { id: 1, name: 'A', type: 'dir', parent_id: 2 },
            { id: 2, name: 'B', type: 'dir', parent_id: 1 },
            { id: 3, name: 'T', type: 'file', parent_id: 1 }
        ]);
        expect(paths[0].path).toBe('tables/B/A/T');
    });
});

describe('rows', () => {
    const columns = export_columns(COLS, NAMES);

    it('keeps named, live columns in order with their types', () => {
        expect(columns.map(c => c.name)).toEqual(['Name', 'Age', 'Born', 'Team']);
        expect(columns[3]).toMatchObject({ type: 'link', link_table_id: 5, link_table: 'teams' });
        expect(columns[0]).toEqual({ name: 'Name', type: 'string', field: 'a' });
    });

    it('formats values by type', () => {
        expect(export_value(new Date(Date.UTC(2020, 0, 2)), 'date')).toBe(
            '2020-01-02T00:00:00.000Z'
        );
        expect(export_value('not a date', 'date')).toBe('not a date');
        expect(export_value(['x', 'y'], 'link')).toEqual(['x', 'y']);
        expect(export_value('x', 'link')).toBeNull();
        expect(export_value(4.5, 'number')).toBe(4.5);
        expect(export_value(7, 'string')).toBe('7');
        expect(export_value(undefined, 'string')).toBeNull();
    });

    it('turns a stored row into one by column name', () => {
        const row = { _id: 'id1', a: 'Ada', b: 36, c: new Date(Date.UTC(1990, 1, 3)), d: ['t1'] };
        expect(export_row(row, columns)).toEqual({
            _id: 'id1',
            Name: 'Ada',
            Age: 36,
            Born: '1990-02-03T00:00:00.000Z',
            Team: ['t1']
        });
    });

    it('quotes CSV cells only when it has to', () => {
        expect(csv_cell('plain')).toBe('plain');
        expect(csv_cell('a,b')).toBe('"a,b"');
        expect(csv_cell('say "hi"')).toBe('"say ""hi"""');
        expect(csv_cell('two\nlines')).toBe('"two\nlines"');
        expect(csv_cell(' padded')).toBe('" padded"');
        expect(csv_cell(null)).toBe('');
        expect(csv_cell(['a', 'b'])).toBe('a b');
        expect(csv_line([1, 'x', null])).toBe('1,x,\r\n');
    });

    it('streams a table as CSV', async () => {
        const csv = await collect(
            csv_chunks(columns, from([{ _id: 'r1', a: 'Ada, Countess', b: 36 }, { _id: 'r2' }]))
        );
        expect(csv).toBe('_id,Name,Age,Born,Team\r\nr1,"Ada, Countess",36,,\r\nr2,,,,\r\n');
    });

    it('streams a table as JSON that parses, with and without rows', async () => {
        const table = { id: 2, name: 'People', folders: ['HR'] };
        const json = await collect(
            json_chunks(
                table,
                columns,
                from([
                    { _id: 'r1', a: 'Ada' },
                    { _id: 'r2', b: 2 }
                ])
            )
        );
        const parsed = JSON.parse(json);
        expect(parsed).toMatchObject({ id: 2, name: 'People', folders: ['HR'] });
        expect(parsed.columns[0]).toEqual({ name: 'Name', type: 'string' });
        expect(parsed.columns[3]).toEqual({
            name: 'Team',
            type: 'link',
            link_table_id: 5,
            link_table: 'teams'
        });
        expect(parsed.rows).toHaveLength(2);
        expect(parsed.rows[1]).toEqual({ _id: 'r2', Name: null, Age: 2, Born: null, Team: null });

        const empty = JSON.parse(await collect(json_chunks(table, columns, from([]))));
        expect(empty.rows).toEqual([]);
    });

    it('hands over chunks of a bounded size, not a whole table at once', async () => {
        const many = Array.from({ length: 5000 }, (_, i) => ({ _id: `r${i}`, a: 'x'.repeat(50) }));
        const sizes: number[] = [];
        for await (const c of csv_chunks(columns, from(many))) sizes.push(c.length);
        expect(sizes.length).toBeGreaterThan(3);
        expect(Math.max(...sizes)).toBeLessThan(EXPORT_LIMITS.chunk_bytes + 200);
    });
});

describe('settings', () => {
    it('leaves out webhook secrets and the account id', () => {
        const hook = {
            id: 'w1',
            account_id: 3,
            file_id: 5,
            url: 'https://example.com/hook',
            events: ['row.created'],
            enabled: true,
            secret: 'whsec_supersecret',
            created_at: 1,
            last_delivery_at: 2,
            last_delivery_status: 'ok'
        };
        const out = webhook_settings(hook, NAMES);
        expect(JSON.stringify(out)).not.toContain('supersecret');
        expect(out).not.toHaveProperty('secret');
        expect(out).not.toHaveProperty('account_id');
        expect(out).toMatchObject({ id: 'w1', file_id: 5, table: 'teams', enabled: true });
        expect(webhook_settings({ ...hook, file_id: null }, NAMES).table).toBeNull();
    });

    it('names the table of forms and views', () => {
        const form = form_settings({ id: 'f', account_id: 3, file_id: 5, title: 'T' }, NAMES);
        expect(form).toEqual({ id: 'f', file_id: 5, title: 'T', table: 'teams' });
        const view = view_settings({ _id: 'x', id: 'v', account_id: 3, file_id: 9 }, NAMES);
        expect(view).toEqual({ id: 'v', file_id: 9, table: null });
    });

    it('lists every table and file in the manifest', () => {
        const m = manifest(Date.UTC(2026, 10, 25), [
            { id: 2, name: 'People', folders: [], path: 'tables/People', rows: 3, columns: 2 }
        ]);
        expect(m.exported_at).toBe('2026-11-25T00:00:00.000Z');
        expect(m.tables).toEqual([
            {
                id: 2,
                name: 'People',
                folders: [],
                columns: 2,
                rows: 3,
                csv: 'tables/People.csv',
                json: 'tables/People.json'
            }
        ]);
        expect(m.files).toEqual({
            forms: 'forms.json',
            views: 'views.json',
            webhooks: 'webhooks.json'
        });
    });
});
