import {
    agent_view_answer,
    check_arguments,
    check_view_args,
    handle_body,
    handle_message,
    JSONRPC_ERRORS,
    MAX_COLUMNS_PER_CALL,
    MAX_ROWS_PER_CALL,
    McpContext,
    negotiate_version,
    new_column_docs,
    PROTOCOL_VERSIONS,
    TABLE_LIMITED_KEY_REFUSAL,
    TOOLS,
    tool_result,
    tools_for
} from './mcp';

const tool = (name: string) => TOOLS.find(t => t.name === name)!;

function ctx(access: 'read' | 'read_write' = 'read_write', answer = { value: { ok: true } }) {
    const calls: { name: string; args: Record<string, unknown> }[] = [];
    const c: McpContext = {
        access,
        run_tool: async (name, args) => {
            calls.push({ name, args });
            return answer;
        }
    };
    return { c, calls };
}

const call = (name: string, args?: unknown, id: number | string = 1) => ({
    jsonrpc: '2.0',
    id,
    method: 'tools/call',
    params: { name, arguments: args }
});

describe('mcp: tools', () => {
    it('a read key sees only the tools that read', () => {
        expect(tools_for('read').map(t => t.name)).toEqual([
            'list_tables',
            'describe_table',
            'query_rows',
            'count_rows',
            'list_views',
            'query_view'
        ]);
        expect(tools_for('read_write').map(t => t.name)).toEqual([
            'list_tables',
            'describe_table',
            'query_rows',
            'count_rows',
            'list_views',
            'query_view',
            'create_rows',
            'update_rows',
            'delete_rows',
            'create_table',
            'add_columns'
        ]);
    });

    it('annotations: reads are read-only, delete is destructive', () => {
        expect(tool('query_rows').annotations.readOnlyHint).toBe(true);
        expect(tool('create_rows').annotations.destructiveHint).toBe(false);
        expect(tool('delete_rows').annotations.destructiveHint).toBe(true);
    });
});

describe('mcp: check_arguments', () => {
    it('accepts a table name or id', () => {
        expect(check_arguments(tool('describe_table'), { table: 'people' })).toBeNull();
        expect(check_arguments(tool('describe_table'), { table: 12 })).toBeNull();
        expect(check_arguments(tool('describe_table'), { table: '' })).toMatch(/table/);
        expect(check_arguments(tool('describe_table'), { table: 1.5 })).toMatch(/table/);
        expect(check_arguments(tool('describe_table'), {})).toBe('table is required');
    });

    it('refuses unknown arguments and non-objects', () => {
        expect(check_arguments(tool('list_tables'), undefined)).toBeNull();
        expect(check_arguments(tool('list_tables'), { x: 1 })).toMatch(/unknown argument: x/);
        expect(check_arguments(tool('list_tables'), [])).toMatch(/object/);
        expect(check_arguments(tool('query_rows'), { table: 't', explain: true })).toMatch(
            /unknown argument: explain/
        );
    });

    it('checks rows and ids', () => {
        const create = tool('create_rows');
        expect(check_arguments(create, { table: 't', rows: [{ Name: 'a' }] })).toBeNull();
        expect(check_arguments(create, { table: 't', rows: [] })).toMatch(/non-empty/);
        expect(check_arguments(create, { table: 't', rows: [1] })).toMatch(/object/);
        expect(check_arguments(create, { table: 't', rows: [{ _id: 'x' }] })).toMatch(/_id/);
        const many = Array.from({ length: MAX_ROWS_PER_CALL + 1 }, () => ({ a: 1 }));
        expect(check_arguments(create, { table: 't', rows: many })).toMatch(/at most/);

        const update = tool('update_rows');
        expect(
            check_arguments(update, { table: 't', rows: [{ _id: 'a1', Name: 'b' }] })
        ).toBeNull();
        expect(check_arguments(update, { table: 't', rows: [{ Name: 'b' }] })).toMatch(/_id/);

        const del = tool('delete_rows');
        expect(check_arguments(del, { table: 't', ids: ['a1'] })).toBeNull();
        expect(check_arguments(del, { table: 't', ids: [1] })).toMatch(/string/);
    });

    it("checks create_table's name, folder and columns", () => {
        const create = tool('create_table');
        const cols = [
            { name: 'Name', type: 'string' },
            { name: 'Age', type: 'number' },
            { name: 'Joined', type: 'date' }
        ];
        expect(check_arguments(create, { name: 'people', columns: cols })).toBeNull();
        expect(
            check_arguments(create, { name: 'people', folder: 'crm', columns: cols })
        ).toBeNull();
        expect(check_arguments(create, { name: 'people', folder: 3, columns: cols })).toBeNull();
        expect(check_arguments(create, { columns: cols })).toBe('name is required');
        expect(check_arguments(create, { name: 'people' })).toBe('columns is required');
        expect(check_arguments(create, { name: 'my people', columns: cols })).toMatch(/name/);
        expect(check_arguments(create, { name: 'x'.repeat(151), columns: cols })).toMatch(
            /at most 150/
        );
        expect(check_arguments(create, { name: 'p', folder: '', columns: cols })).toMatch(/folder/);
        expect(check_arguments(create, { name: 'p', folder: 1.5, columns: cols })).toMatch(
            /folder/
        );
        expect(check_arguments(create, { name: 'p', columns: cols, table: 't' })).toMatch(
            /unknown argument: table/
        );
    });

    it('checks the columns of create_table and add_columns', () => {
        for (const t of [tool('create_table'), tool('add_columns')]) {
            const args = (columns: unknown) =>
                t.name === 'create_table' ? { name: 'p', columns } : { table: 'p', columns };
            expect(check_arguments(t, args([{ name: 'A', type: 'string' }]))).toBeNull();
            expect(check_arguments(t, args([]))).toMatch(/non-empty/);
            expect(check_arguments(t, args('A'))).toMatch(/non-empty/);
            expect(check_arguments(t, args(['A']))).toMatch(/object/);
            expect(check_arguments(t, args([{ type: 'string' }]))).toMatch(/name/);
            expect(check_arguments(t, args([{ name: ' ', type: 'string' }]))).toMatch(/name/);
            expect(check_arguments(t, args([{ name: 'A' }]))).toMatch(/type must be one of/);
            // Link and AI columns need settings of their own
            expect(check_arguments(t, args([{ name: 'A', type: 'link' }]))).toMatch(/type/);
            expect(
                check_arguments(t, args([{ name: 'A', type: 'string', link_table_id: 2 }]))
            ).toMatch(/unknown column key: link_table_id/);
            expect(
                check_arguments(
                    t,
                    args([
                        { name: 'A', type: 'string' },
                        { name: 'A', type: 'number' }
                    ])
                )
            ).toBe('Duplicate column name: A');
            const many = Array.from({ length: MAX_COLUMNS_PER_CALL + 1 }, (_, i) => ({
                name: `c${i}`,
                type: 'string'
            }));
            expect(check_arguments(t, args(many))).toMatch(/at most/);
        }
        expect(check_arguments(tool('add_columns'), { columns: [] })).toBe('table is required');
    });

    it('checks the query keys it relies on', () => {
        const q = tool('query_rows');
        expect(check_arguments(q, { table: 't', limit: 10, cursor: 'c', match: 'any' })).toBeNull();
        expect(check_arguments(q, { table: 't', limit: 0 })).toMatch(/limit/);
        expect(check_arguments(q, { table: 't', cursor: 3 })).toMatch(/cursor/);
        expect(check_arguments(q, { table: 't', match: 'some' })).toMatch(/match/);
    });

    it("checks list_views' and query_view's arguments", () => {
        expect(check_arguments(tool('list_views'), { table: 'people' })).toBeNull();
        expect(check_arguments(tool('list_views'), {})).toBe('table is required');
        const q = tool('query_view');
        const id = 'view_0123456789abcdef01234567';
        expect(check_arguments(q, { view: id })).toBeNull();
        expect(check_arguments(q, { view: id, limit: 5, cursor: 'c' })).toBeNull();
        expect(check_arguments(q, { view: id, from: '2026-12-01', to: '2027-01-01' })).toBeNull();
        expect(check_arguments(q, {})).toBe('view is required');
        expect(check_arguments(q, { view: '' })).toMatch(/view id/);
        expect(check_arguments(q, { view: 3 })).toMatch(/view id/);
        expect(check_arguments(q, { view: id, limit: 0 })).toMatch(/limit/);
        expect(check_arguments(q, { view: id, from: 20261201 })).toMatch(/from/);
        expect(check_arguments(q, { view: id, table: 't' })).toMatch(/unknown argument: table/);
    });

    it('views are read tools, open to read keys', () => {
        for (const name of ['list_views', 'query_view']) {
            expect(tool(name).write).toBe(false);
            expect(tool(name).annotations.readOnlyHint).toBe(true);
        }
    });
});

describe('mcp: saved views', () => {
    it("limit and cursor are a grid's, from and to a calendar's", () => {
        expect(check_view_args('grid', { view: 'v', limit: 5, cursor: 'c' })).toBeNull();
        expect(check_view_args('calendar', { view: 'v', from: 'a', to: 'b' })).toBeNull();
        expect(check_view_args('kanban', { view: 'v' })).toBeNull();
        expect(check_view_args('chart', { view: 'v', limit: 5 })).toMatch(/grid views only/);
        expect(check_view_args('calendar', { view: 'v', cursor: 'c' })).toMatch(/grid/);
        expect(check_view_args('grid', { view: 'v', from: '2026-01-01' })).toMatch(
            /calendar views only/
        );
        expect(check_view_args('map', { view: 'v', to: '2026-01-01' })).toMatch(/calendar/);
    });

    const columns = [
        { field: 'a', name: 'Task' },
        { field: 'b', name: 'Status' },
        { field: 'c', name: 'Hours' }
    ];

    it("names a view's columns and keys a board's rows by name", () => {
        const answer = {
            group_field: 'b',
            groups: [
                {
                    value: 'Done',
                    count: 1,
                    rows: [{ _id: 'r1', a: 'Ship', b: 'Done', c: 2, row_index: 4, _ai: {} }]
                }
            ],
            truncated: false,
            columns: [{ field: 'a', name: 'Task', type: 'string' }]
        };
        expect(agent_view_answer(answer, columns, columns.slice(0, 2))).toEqual({
            group_column: 'Status',
            groups: [
                { value: 'Done', count: 1, rows: [{ _id: 'r1', Task: 'Ship', Status: 'Done' }] }
            ],
            truncated: false
        });
    });

    it("names a chart's, calendar's and map's columns (null when unset or gone)", () => {
        expect(
            agent_view_answer(
                {
                    kind: 'pie',
                    group_field: 'b',
                    agg: 'sum',
                    value_field: 'c',
                    points: [{ label: 'Done', value: 2 }],
                    truncated: false
                },
                columns,
                columns
            )
        ).toEqual({
            kind: 'pie',
            group_column: 'Status',
            agg: 'sum',
            value_column: 'Hours',
            points: [{ label: 'Done', value: 2 }],
            truncated: false
        });
        expect(
            agent_view_answer(
                { date_field: 'c', title_field: null, from: '2026-12-01', events: [] },
                columns,
                columns
            )
        ).toEqual({ date_column: 'Hours', title_column: null, from: '2026-12-01', events: [] });
        expect(
            agent_view_answer(
                { lat_field: 'c', lng_field: 'z', label_field: 'a', points: [], missing: 1 },
                columns,
                columns
            )
        ).toEqual({
            lat_column: 'Hours',
            lng_column: null,
            label_column: 'Task',
            points: [],
            missing: 1
        });
    });
});

describe('mcp: new_column_docs', () => {
    const next = (f: string) => String.fromCharCode(f.charCodeAt(0) + 1);
    const cols = [
        { name: 'Name', type: 'string' },
        { name: 'Age', type: 'number' }
    ];

    it('a new table starts at field a', () => {
        expect(new_column_docs(7, cols, null, next)).toEqual([
            {
                file_directory_id: 7,
                col_index: 1,
                field: 'a',
                order: 1,
                headerName: 'Name',
                width: 200,
                col_type: 'string'
            },
            {
                file_directory_id: 7,
                col_index: 2,
                field: 'b',
                order: 2,
                headerName: 'Age',
                width: 200,
                col_type: 'number'
            }
        ]);
    });

    it('goes on after the last column, skipping fields in use', () => {
        const docs = new_column_docs(7, cols, { field: 'c', col_index: 3 }, next, new Set(['e']));
        expect(docs.map(d => [d.field, d.col_index, d.order])).toEqual([
            ['d', 4, 4],
            ['f', 5, 5]
        ]);
    });
});

describe('mcp: protocol', () => {
    it('negotiates the version', () => {
        expect(negotiate_version('2025-03-26')).toBe('2025-03-26');
        expect(negotiate_version('1999-01-01')).toBe(PROTOCOL_VERSIONS[0]);
        expect(negotiate_version(undefined)).toBe(PROTOCOL_VERSIONS[0]);
    });

    it('initialize answers the version, tools capability and server info', async () => {
        const { c } = ctx();
        const res: any = await handle_message(
            {
                jsonrpc: '2.0',
                id: 1,
                method: 'initialize',
                params: { protocolVersion: '2025-06-18' }
            },
            c
        );
        expect(res.result.protocolVersion).toBe('2025-06-18');
        expect(res.result.capabilities).toEqual({ tools: { listChanged: false } });
        expect(res.result.serverInfo.name).toBe('invokedb');
    });

    it('notifications and client responses get no answer', async () => {
        const { c } = ctx();
        expect(
            await handle_message({ jsonrpc: '2.0', method: 'notifications/initialized' }, c)
        ).toBeNull();
        expect(await handle_message({ jsonrpc: '2.0', id: 5, result: {} }, c)).toBeNull();
    });

    it('ping, unknown methods and bad messages', async () => {
        const { c } = ctx();
        expect(await handle_message({ jsonrpc: '2.0', id: 'p', method: 'ping' }, c)).toEqual({
            jsonrpc: '2.0',
            id: 'p',
            result: {}
        });
        const unknown: any = await handle_message(
            { jsonrpc: '2.0', id: 2, method: 'resources/list' },
            c
        );
        expect(unknown.error.code).toBe(JSONRPC_ERRORS.method_not_found);
        const bad: any = await handle_message({ id: 3, method: 'ping' }, c);
        expect(bad.error.code).toBe(JSONRPC_ERRORS.invalid_request);
        const bad_id: any = await handle_message({ jsonrpc: '2.0', id: {}, method: 'ping' }, c);
        expect(bad_id.error.code).toBe(JSONRPC_ERRORS.invalid_request);
    });

    it('tools/list depends on the key', async () => {
        const read: any = await handle_message(
            { jsonrpc: '2.0', id: 1, method: 'tools/list' },
            ctx('read').c
        );
        expect(read.result.tools.map(t => t.name)).not.toContain('create_rows');
        expect(read.result.tools[0]).not.toHaveProperty('write');
        expect(read.result.tools[0].inputSchema.type).toBe('object');
    });

    it('tools/call runs the tool with its checked arguments', async () => {
        const { c, calls } = ctx();
        const res: any = await handle_message(call('query_rows', { table: 'people', limit: 5 }), c);
        expect(calls).toEqual([{ name: 'query_rows', args: { table: 'people', limit: 5 } }]);
        expect(res.result.isError).toBe(false);
        expect(res.result.structuredContent).toEqual({ ok: true });
        expect(JSON.parse(res.result.content[0].text)).toEqual({ ok: true });
    });

    it('a read key calling a write tool, or bad arguments, is a tool error, not run', async () => {
        const { c, calls } = ctx('read');
        const res: any = await handle_message(call('delete_rows', { table: 't', ids: ['a'] }), c);
        expect(res.result).toEqual({
            content: [{ type: 'text', text: 'This API key is read-only' }],
            isError: true
        });
        const bad: any = await handle_message(call('describe_table', {}), c);
        expect(bad.result.isError).toBe(true);
        expect(calls).toEqual([]);
    });

    it('a key limited to some tables gets a tool error for create_table and add_columns', async () => {
        const { c, calls } = ctx();
        c.table_limited = true;
        const cols = [{ name: 'A', type: 'string' }];
        for (const msg of [
            call('create_table', { name: 'p', columns: cols }),
            call('add_columns', { table: 'p', columns: cols })
        ]) {
            const res: any = await handle_message(msg, c);
            expect(res.result).toEqual({
                content: [{ type: 'text', text: TABLE_LIMITED_KEY_REFUSAL }],
                isError: true
            });
        }
        // Its rows tools still run
        await handle_message(call('create_rows', { table: 'p', rows: [{ A: 'x' }] }), c);
        expect(calls.map(x => x.name)).toEqual(['create_rows']);

        const read: any = await handle_message(
            call('create_table', { name: 'p', columns: cols }),
            ctx('read').c
        );
        expect(read.result.content[0].text).toBe('This API key is read-only');
    });

    it('an unknown tool is a JSON-RPC error', async () => {
        const res: any = await handle_message(call('drop_database', {}), ctx().c);
        expect(res.error.code).toBe(JSONRPC_ERRORS.invalid_params);
    });

    it("a tool's refusal reaches the agent as an error result", () => {
        expect(tool_result({ error: 'No table "x"' })).toEqual({
            content: [{ type: 'text', text: 'No table "x"' }],
            isError: true
        });
        expect(tool_result({ value: [1, 2] })).not.toHaveProperty('structuredContent');
    });
});

describe('mcp: handle_body', () => {
    it('one message, a notification, a batch', async () => {
        const { c } = ctx();
        expect(await handle_body({ jsonrpc: '2.0', id: 1, method: 'ping' }, c)).toEqual({
            status: 200,
            body: { jsonrpc: '2.0', id: 1, result: {} }
        });
        expect(
            await handle_body({ jsonrpc: '2.0', method: 'notifications/initialized' }, c)
        ).toEqual({
            status: 202
        });
        const batch = await handle_body(
            [
                { jsonrpc: '2.0', method: 'notifications/initialized' },
                { jsonrpc: '2.0', id: 2, method: 'ping' }
            ],
            c
        );
        expect(batch).toEqual({ status: 200, body: [{ jsonrpc: '2.0', id: 2, result: {} }] });
        expect((await handle_body([], c)).status).toBe(400);
    });
});
