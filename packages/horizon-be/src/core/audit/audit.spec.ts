import {
    AUDIT_MAX_IDS,
    AUDIT_PAGE_DEFAULT,
    AUDIT_PAGE_MAX,
    AuditPageError,
    actor_of,
    api_key_change,
    audit_cutoff,
    column_changes,
    encode_audit_cursor,
    form_actor,
    new_audit_id,
    parse_audit_page,
    row_change,
    source_of,
    table_change,
    updated_columns
} from './audit';

describe('audit actor', () => {
    it('is the signed-in user for the app', () => {
        const actor = actor_of({ id: 1, email: 'demo@invokedb.com' });
        expect(actor).toEqual({ type: 'user', label: 'demo@invokedb.com' });
        expect(source_of(actor)).toBe('app');
    });

    it("is the API key's name and prefix, never the key, for /api/v1", () => {
        const actor = actor_of({
            id: 1,
            email: 'demo@invokedb.com',
            key_scope: {
                key_id: 9,
                access: 'read_write',
                table_ids: null,
                name: 'CI',
                prefix: 'abc123'
            }
        });
        expect(actor).toEqual({
            type: 'api_key',
            label: 'CI (abc123…)',
            key_id: 9,
            key_prefix: 'abc123'
        });
        expect(source_of(actor)).toBe('api');
    });

    it('is the form for a public submission', () => {
        const actor = form_actor('f1', 'Signup');
        expect(actor.label).toBe('Form "Signup"');
        expect(source_of(actor)).toBe('form');
    });
});

describe('audit row changes', () => {
    it('counts the rows and keeps the first ids', () => {
        const ids = Array.from({ length: 30 }, (_, i) => `id${i}`);
        const { summary, details } = row_change('row.deleted', ids);
        expect(summary).toBe('Deleted 30 rows');
        expect(details.count).toBe(30);
        expect(details.row_ids).toHaveLength(AUDIT_MAX_IDS);
    });

    it('names the columns an update set', () => {
        const cols = [
            { field: 'c1', headerName: 'Name' },
            { field: 'c2', headerName: 'Price' }
        ];
        const names = updated_columns(
            [
                { _id: 'a', c1: 'x' },
                { _id: 'b', c1: 'y', c2: 3 }
            ],
            cols
        );
        expect(names).toEqual(['Name', 'Price']);
        expect(row_change('row.updated', ['a'], names).summary).toBe('Updated 1 row: Name, Price');
        expect(row_change('row.created', ['a', 'b']).summary).toBe('Added 2 rows');
    });
});

describe('audit column changes', () => {
    const before = [
        { _id: '1', field: 'c1', headerName: 'Name', col_type: 'string' },
        { _id: '2', field: 'c2', headerName: '', col_type: 'string' },
        { _id: '3', field: 'c3', headerName: 'Price', col_type: 'number', indexed: false }
    ];

    it('logs renames, types and indexes, not widths or order', () => {
        const changes = column_changes(before, [
            { _id: '1', headerName: 'Full name', width: 300 },
            { _id: '3', col_type: 'string', indexed: true },
            { _id: '1', order: 4, width: 120 }
        ]);
        expect(changes.map(c => c.action)).toEqual(['column.updated', 'column.updated']);
        expect(changes[0].summary).toBe(
            'Changed column "Full name": renamed "Name" to "Full name"'
        );
        expect(changes[1].details.changes).toEqual(['type number → string', 'indexed']);
    });

    it('logs a placeholder named for the first time as added, and deletes', () => {
        const changes = column_changes(before, [
            { _id: '2', headerName: 'Email' },
            { _id: '3', deleted: true },
            { _id: 'missing', headerName: 'x' }
        ]);
        expect(changes.map(c => [c.action, c.details.column])).toEqual([
            ['column.created', 'Email'],
            ['column.deleted', 'Price']
        ]);
    });
});

describe('audit tables and keys', () => {
    it('says what happened', () => {
        expect(table_change('table.created', 'Orders').summary).toBe('Created table "Orders"');
        expect(table_change('table.renamed', 'B', 'A').summary).toBe('Renamed table "A" to "B"');
        expect(table_change('table.deleted', 'Orders').summary).toBe('Deleted table "Orders"');
        expect(
            api_key_change('api_key.created', { name: 'CI', prefix: 'abc123', access: 'read' })
                .summary
        ).toBe('Created API key "CI" (abc123…), read');
        expect(api_key_change('api_key.revoked', { name: 'CI', prefix: 'abc123' }).summary).toBe(
            'Revoked API key "CI" (abc123…)'
        );
    });
});

describe('audit paging', () => {
    it('defaults and bounds the page size', () => {
        expect(parse_audit_page({})).toEqual({ limit: AUDIT_PAGE_DEFAULT, before: null });
        expect(parse_audit_page({ limit: '10' }).limit).toBe(10);
        for (const limit of ['0', String(AUDIT_PAGE_MAX + 1), 'x', '1.5']) {
            expect(() => parse_audit_page({ limit })).toThrow(AuditPageError);
        }
    });

    it('reads back its own cursor and refuses others', () => {
        const id = new_audit_id();
        const cursor = encode_audit_cursor({ created_at: 1700000000000, id });
        expect(parse_audit_page({ cursor }).before).toEqual({ at: 1700000000000, id });
        expect(() => parse_audit_page({ cursor: 'nope' })).toThrow(AuditPageError);
        expect(() => parse_audit_page({ cursor: { $gt: 1 } })).toThrow(AuditPageError);
    });

    it('makes ids that sort in the order they were made', () => {
        const a = new_audit_id();
        const b = new_audit_id();
        expect(a < b).toBe(true);
    });

    it('keeps 90 days', () => {
        const now = Date.UTC(2026, 10, 25);
        expect(now - audit_cutoff(now)).toBe(90 * 24 * 60 * 60 * 1000);
    });
});
