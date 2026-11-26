import {
    check_arguments,
    handle_body,
    handle_message,
    JSONRPC_ERRORS,
    MAX_ROWS_PER_CALL,
    McpContext,
    negotiate_version,
    PROTOCOL_VERSIONS,
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
            'count_rows'
        ]);
        expect(tools_for('read_write').map(t => t.name)).toEqual([
            'list_tables',
            'describe_table',
            'query_rows',
            'count_rows',
            'create_rows',
            'update_rows',
            'delete_rows'
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

    it('checks the query keys it relies on', () => {
        const q = tool('query_rows');
        expect(check_arguments(q, { table: 't', limit: 10, cursor: 'c', match: 'any' })).toBeNull();
        expect(check_arguments(q, { table: 't', limit: 0 })).toMatch(/limit/);
        expect(check_arguments(q, { table: 't', cursor: 3 })).toMatch(/cursor/);
        expect(check_arguments(q, { table: 't', match: 'some' })).toMatch(/match/);
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
