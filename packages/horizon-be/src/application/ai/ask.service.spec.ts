import {
    BadGatewayException,
    BadRequestException,
    ForbiddenException,
    HttpException,
    NotFoundException,
    ServiceUnavailableException
} from '@nestjs/common';
import { ObjectId } from 'mongodb';
import { AskService } from './ask.service';
import { EditService } from './edit.service';
import { ASK_MAX_TURNS } from '@app/core/ai/ask';
import { AI_ALLOWANCES } from '@app/core/ai/ai-plan';
import { AiSpend } from '@app/core/ai/ai-spend';
import * as telegram from '@app/core/telegram/telegram';

// Stand-ins below; the real ones pull in TypeORM, ESM-only packages and the Anthropic SDK.
// The model is never called: every reply is scripted.
jest.mock('../file-directory/file-directory.service', () => ({}));
jest.mock('../account/account.service', () => ({}));
jest.mock('../web-file/web-file.service', () => ({}));
jest.mock('../../core/ai/ai-client', () => ({ AiClient: class {} }));
jest.mock('../../core/telegram/telegram', () => ({
    telegram_configured: () => true,
    send_telegram: jest.fn(async () => undefined)
}));

const ACCT = 7;
const OTHER = 8;
const NOW = Date.UTC(2026, 10, 25, 12);

const ROWS = [
    { _id: new ObjectId(), a: 'Pen', b: 2 },
    { _id: new ObjectId(), a: 'Lamp', b: 30 },
    { _id: new ObjectId(), a: 'Desk', b: 250 }
];

// The rows of another of the account's tables (#322), "Signups"
const SIGNUPS = [
    { _id: new ObjectId(), e: 'ada@example.com', n: 5 },
    { _id: new ObjectId(), e: 'bea@example.com', n: 12 }
];

function rows_of(file_id: unknown) {
    return Number(file_id) === 14 ? SIGNUPS : ROWS;
}

function tool_use(input: any, id = 'tu_1', name = 'run_query') {
    return { type: 'tool_use', id, name, input };
}

function text(t: string) {
    return { type: 'text', text: t };
}

// The server's monthly budget in the tests: $1
const SERVER_BUDGET = 1_000_000;

function setup(
    replies: any[][],
    opts: {
        available?: boolean;
        subscription_id?: string;
        email_verified?: boolean;
        usage?: any;
        files?: Record<number, any>;
    } = {}
) {
    const files = {
        11: { id: 11, account_id: ACCT, name: 'Products', type: 'file', deleted: false },
        12: { id: 12, account_id: OTHER, name: 'Theirs', type: 'file', deleted: false },
        13: { id: 13, account_id: ACCT, name: 'Gone', type: 'file', deleted: true },
        // The account's other tables (#322)
        14: { id: 14, account_id: ACCT, name: 'Signups', type: 'file', deleted: false },
        15: { id: 15, account_id: ACCT, name: 'Twin', type: 'file', deleted: false },
        16: { id: 16, account_id: ACCT, name: 'twin ', type: 'file', deleted: false },
        17: { id: 17, account_id: ACCT, name: 'A folder', type: 'directory', deleted: false },
        ...(opts.files || {})
    };
    const file_directory_svc = {
        assert_owned: jest.fn(async (acct, id) => {
            const f = files[Number(id)];
            if (!f) throw new NotFoundException();
            if (f.account_id !== acct) throw new ForbiddenException();
            return f;
        }),
        get_by_account_id: jest.fn(async acct =>
            Object.values(files).filter((f: any) => f.account_id === acct && !f.deleted)
        )
    };
    const account_svc = {
        get: jest.fn(async id => ({
            id,
            subscription_id: opts.subscription_id || null,
            email_verified: opts.email_verified !== false
        }))
    };
    const tracking_manager = {
        check_account_lock: jest.fn(async () => undefined),
        check_not_read_only: jest.fn(async () => undefined)
    };
    const web_file_manager = {
        get_columns: jest.fn(async (_acct, file_id) =>
            Number(file_id) === 14
                ? [
                      { field: 'e', headerName: 'Email' },
                      { field: 'n', headerName: 'Visits', col_type: 'number' }
                  ]
                : [
                      { field: 'a', headerName: 'Name' },
                      { field: 'b', headerName: 'Price', col_type: 'number' }
                  ]
        ),
        // A tiny Mongo: $and of { field: { $gt } } conditions, sorted by the first sort key
        query_rows: jest.fn(async (_acct, file_id, query) => {
            let docs = rows_of(file_id).filter(r => matches(r, query.filter));
            const key = query.sort[0];
            if (key.field !== '_id') {
                docs = [...docs].sort((x, y) => (x[key.field] - y[key.field]) * key.dir);
            }
            return { docs: docs.slice(0, query.limit + 1), explain: null };
        }),
        count_rows: jest.fn(
            async (_acct, file_id, query) =>
                rows_of(file_id).filter(r => matches(r, query.filter)).length
        ),
        format_date_field: jest.fn(v => v)
    };
    const calls: any[] = [];
    const ai_client = {
        available: jest.fn(() => opts.available !== false),
        budget_micros: jest.fn(() => SERVER_BUDGET),
        create_message: jest.fn(async (params: any) => {
            calls.push(JSON.parse(JSON.stringify(params)));
            const content = replies.shift();
            if (!content) throw new Error('no more replies');
            return {
                reply: { content, usage: opts.usage || { input_tokens: 100, output_tokens: 10 } },
                model: 'claude-haiku-5-5'
            };
        })
    };
    const usage: Record<string, any> = {};
    const server: Record<string, number> = {};
    const key = (acct, month) => `${acct}:${month}`;
    const ai_usage = {
        get: jest.fn(async (acct, month) => ({
            month,
            questions: 0,
            input_tokens: 0,
            output_tokens: 0,
            cost_micros: 0,
            ...usage[key(acct, month)]
        })),
        reserve: jest.fn(async (acct, month, limit, budget) => {
            const u = (usage[key(acct, month)] = usage[key(acct, month)] || { questions: 0 });
            if (u.questions >= limit || (u.cost_micros || 0) >= budget) return false;
            u.questions++;
            return true;
        }),
        release: jest.fn(async (acct, month) => usage[key(acct, month)].questions--),
        add_usage: jest.fn(async (acct, month, i, o, c) => {
            const u = usage[key(acct, month)];
            u.input_tokens = (u.input_tokens || 0) + i;
            u.output_tokens = (u.output_tokens || 0) + o;
            u.cost_micros = (u.cost_micros || 0) + c;
        }),
        server_cost: jest.fn(async month => server[month] || 0),
        add_server_cost: jest.fn(async (month, c) => {
            const before = server[month] || 0;
            server[month] = before + c;
            return { before, after: server[month] };
        })
    };
    // Generated rows (#148), when the model calls propose_rows (#234)
    const ai_service = {
        preview_rows: jest.fn(async (_account: any, _file: any, request: any) => ({
            rows: Array.from({ length: request.count }, (_, i) => ({ a: `Row ${i + 1}`, b: i })),
            columns: [
                { field: 'a', name: 'Name', type: 'string' },
                { field: 'b', name: 'Price', type: 'number' }
            ],
            usage: { month: '2026-11', used: request.count, limit: 50 }
        })),
        // Rows the model gave itself (#322): as AiService.given_rows answers them
        given_rows: jest.fn(async (_account: any, _file: any, rows: any[]) => ({
            rows: rows.map(r => ({ a: r.Name ?? null, b: r.Price ?? null })),
            columns: [
                { field: 'a', name: 'Name', type: 'string' },
                { field: 'b', name: 'Price', type: 'number' }
            ],
            usage: { month: '2026-11', used: rows.length, limit: 50 }
        })),
        rows_usage: jest.fn(async () => ({ month: '2026-11', used: 0, limit: 50 }))
    };
    const web_file_svc = { batch_update_internal: jest.fn(async () => 0) };
    const svc = new AskService(
        file_directory_svc as any,
        account_svc as any,
        tracking_manager as any,
        web_file_manager as any,
        ai_client as any,
        ai_usage as any,
        new AiSpend(ai_client as any, ai_usage as any),
        ai_service as any,
        // Edits (#204) are worked out on the rows above; nothing is written by a preview
        new EditService(
            file_directory_svc as any,
            account_svc as any,
            web_file_manager as any,
            web_file_svc as any
        )
    );
    svc.now = () => NOW;
    return {
        svc,
        calls,
        usage,
        server,
        ai_client,
        ai_usage,
        ai_service,
        web_file_manager,
        web_file_svc,
        tracking_manager
    };
}

function matches(row: any, filter: any): boolean {
    if (!filter || Object.keys(filter).length === 0) return true;
    if (filter.$and) return filter.$and.every(f => matches(row, f));
    return Object.keys(filter).every(field => {
        const cond = filter[field];
        if (cond && typeof cond === 'object' && '$gt' in cond) return row[field] > cond.$gt;
        return row[field] === cond;
    });
}

const BASE = 'http://api.test/api/v1';

describe('AskService', () => {
    it('answers with the rows behind the answer and the API call', async () => {
        const { svc, calls, usage } = setup([
            [
                tool_use({
                    filters: [{ column: 'Price', op: 'gt', value: 10 }],
                    sort: [{ column: 'Price', dir: 'desc' }]
                })
            ],
            [text('Two products cost more than 10: Desk and Lamp.')]
        ]);
        const res = await svc.ask(ACCT, { table: 11, question: 'What costs more than 10?' }, BASE);
        expect(res.answer).toBe('Two products cost more than 10: Desk and Lamp.');
        expect(res.total).toBe(2);
        expect(res.columns).toEqual(['Name', 'Price']);
        expect(res.rows.map(r => r.Name)).toEqual(['Desk', 'Lamp']);
        expect(res.api_call.url).toBe(`${BASE}/query?table=Products`);
        expect(res.api_call.body).toEqual({
            filters: [{ column: 'Price', op: 'gt', value: 10 }],
            sort: [{ column: 'Price', dir: 'desc' }],
            limit: 20
        });
        expect(res.api_call.curl).toContain('curl -X POST');
        expect(res.usage).toMatchObject({
            used: 1,
            limit: AI_ALLOWANCES.FREE.questions,
            tier: 'FREE'
        });
        // Two Haiku calls of 100 input and 10 output tokens: 2 × (10 + 5) micro-dollars
        expect(usage[`${ACCT}:2026-11`]).toMatchObject({
            questions: 1,
            input_tokens: 200,
            output_tokens: 20,
            cost_micros: 30
        });

        // No forced tool call (current models refuse it); the schema and samples go in the
        // system prompt
        expect(calls[0].tool_choice).toEqual({ type: 'auto' });
        expect(calls[0].system).toContain('"Products"');
        expect(calls[0].system).toContain('"Price" (number)');
        expect(calls[0].messages).toEqual([{ role: 'user', content: 'What costs more than 10?' }]);
        // The rows go back to the model as the tool's result
        const result = calls[1].messages[2].content[0];
        expect(result).toMatchObject({ type: 'tool_result', tool_use_id: 'tu_1' });
        expect(JSON.parse(result.content)).toMatchObject({ total_matching: 2, returned: 2 });
    });

    it('sends a bad query back to the model and never runs it', async () => {
        const { svc, calls, web_file_manager } = setup([
            [tool_use({ filters: [{ column: 'Price', op: '$where', value: 'sleep(100)' }] })],
            [tool_use({ cursor: 'x' }, 'tu_2')],
            [tool_use({ explain: true }, 'tu_3')],
            [text('I could not answer that.')]
        ]);
        const res = await svc.ask(ACCT, { table: 11, question: 'anything' }, BASE);
        expect(res.answer).toBe('I could not answer that.');
        expect(res.api_call).toBeNull();
        expect(res.rows).toEqual([]);
        const first = calls[1].messages[2].content[0];
        expect(first).toMatchObject({ is_error: true, tool_use_id: 'tu_1' });
        expect(first.content).toContain('unknown operator');
        const second = calls[2].messages[4].content[0];
        expect(second).toMatchObject({ is_error: true, tool_use_id: 'tu_2' });
        // Only the sample rows were read
        expect(web_file_manager.query_rows).toHaveBeenCalledTimes(1);
        expect(web_file_manager.count_rows).not.toHaveBeenCalled();
        // The last turn may only answer
        expect(calls).toHaveLength(ASK_MAX_TURNS);
        expect(calls[ASK_MAX_TURNS - 1].tool_choice).toEqual({ type: 'none' });
    });

    it("lists the account's other tables in the prompt, not another account's (#322)", async () => {
        const { svc, calls } = setup([[tool_use({})], [text('Three.')]]);
        await svc.ask(ACCT, { table: 11, question: 'how many?' }, BASE);
        const system = calls[0].system;
        expect(system).toContain('- "Signups": "Email" (string), "Visits" (number)');
        expect(system).toContain('- "Twin": ');
        expect(system).not.toContain('Theirs');
        expect(system).not.toContain('Gone');
        expect(system).not.toContain('A folder');
        expect(system).not.toContain('more tables not listed');
        // run_query takes a table, and column names aren't limited to this table's
        const props = calls[0].tools[0].input_schema.properties;
        expect(props.table.type).toBe('string');
        expect(props.fields.items.enum).toBeUndefined();
    });

    it('caps the tables and columns listed, and says so (#322)', async () => {
        const files = {};
        for (let i = 0; i < 40; i++) {
            files[100 + i] = {
                id: 100 + i,
                account_id: ACCT,
                name: `T${String(i).padStart(2, '0')}`,
                type: 'file',
                deleted: false
            };
        }
        const { svc, calls, web_file_manager } = setup([[tool_use({})], [text('x')]], { files });
        await svc.ask(ACCT, { table: 11, question: 'q' }, BASE);
        // 44 other tables (Signups, Twin, twin, T00..T39): 30 listed, the rest counted
        expect(calls[0].system).toContain('(and 13 more tables not listed)');
        // Columns are read for the listed tables only (and the current one)
        expect(web_file_manager.get_columns).toHaveBeenCalledTimes(31);
    });

    it("reads another of the account's tables and proposes rows from it (#322)", async () => {
        const { svc, calls, usage, ai_service, web_file_svc } = setup([
            [tool_use({ table: 'signups', fields: ['Email'] })],
            [
                tool_use(
                    {
                        description: 'products named after the signups',
                        rows: [{ Name: 'ada@example.com' }, { Name: 'bea@example.com' }]
                    },
                    'tu_2',
                    'propose_rows'
                )
            ]
        ]);
        const res = await svc.ask(ACCT, { table: 11, question: 'add rows from Signups' }, BASE);
        // The rows read went back to the model
        const result = JSON.parse(calls[1].messages[2].content[0].content);
        expect(result.rows.map(r => r.Email)).toEqual(['ada@example.com', 'bea@example.com']);
        // The answer shows the table read and its API call
        expect(res.table).toBe('Signups');
        expect(res.rows.map(r => r.Email)).toEqual(['ada@example.com', 'bea@example.com']);
        expect(res.columns).toEqual(['Email']);
        expect(res.api_call.url).toBe(`${BASE}/query?table=Signups`);
        expect(res.api_call.body).toEqual({ fields: ['Email'], limit: 20 });
        // The rows are proposed for this table, checked by given_rows, with no generation
        expect(ai_service.preview_rows).not.toHaveBeenCalled();
        const [account, file, rows] = ai_service.given_rows.mock.calls[0];
        expect(account.id).toBe(ACCT);
        expect(file.id).toBe(11);
        expect(rows).toEqual([{ Name: 'ada@example.com' }, { Name: 'bea@example.com' }]);
        expect(res.proposed.rows).toEqual([
            { a: 'ada@example.com', b: null },
            { a: 'bea@example.com', b: null }
        ]);
        expect(res.answer).toContain('2 new rows');
        // Nothing written, one question used, two model calls
        expect(web_file_svc.batch_update_internal).not.toHaveBeenCalled();
        expect(calls).toHaveLength(2);
        expect(usage[`${ACCT}:2026-11`].questions).toBe(1);
    });

    it("can't read another account's table, an unknown one or an ambiguous name (#322)", async () => {
        const { svc, calls, web_file_manager } = setup([
            [tool_use({ table: 'Theirs' })],
            [tool_use({ table: 'Gone' }, 'tu_2')],
            [tool_use({ table: 'twin' }, 'tu_3')],
            [text('I can only read your tables.')]
        ]);
        const res = await svc.ask(ACCT, { table: 11, question: 'read Theirs' }, BASE);
        const errors = [calls[1].messages[2], calls[2].messages[4], calls[3].messages[6]].map(
            m => m.content[0]
        );
        expect(errors.every(e => e.is_error === true)).toBe(true);
        expect(errors[0].content).toBe('There is no table named "Theirs" in this account');
        expect(errors[1].content).toContain('no table named "Gone"');
        expect(errors[2].content).toContain('2 tables are named "twin"');
        expect(res.api_call).toBeNull();
        expect(res.table).toBeNull();
        expect(res.rows).toEqual([]);
        // Only this table's sample rows were read; never the other account's table
        expect(web_file_manager.query_rows).toHaveBeenCalledTimes(1);
        expect(web_file_manager.query_rows.mock.calls.every(c => c[0] === ACCT)).toBe(true);
        expect(web_file_manager.get_columns.mock.calls.some(c => c[1] === 12)).toBe(false);
    });

    it('sends bad explicit rows back to the model (#322)', async () => {
        const { svc, calls, ai_service } = setup([
            [tool_use({ rows: ['not a row'] }, 'tu_1', 'propose_rows')],
            [text('Sorry.')]
        ]);
        await svc.ask(ACCT, { table: 11, question: 'add rows' }, BASE);
        expect(ai_service.given_rows).not.toHaveBeenCalled();
        expect(calls[1].messages[2].content[0]).toMatchObject({ is_error: true });
    });

    it('proposes rows when asked for them, saving nothing (#234)', async () => {
        const { svc, calls, usage, ai_service } = setup([
            [tool_use({ count: 3, description: 'VIP signups' }, 'tu_1', 'propose_rows')]
        ]);
        const res = await svc.ask(ACCT, { table: 11, question: 'add 3 VIP signups' }, BASE);
        // One model call: the rows come from the generator, not another turn
        expect(calls).toHaveLength(1);
        expect(calls[0].tools.map(t => t.name)).toEqual([
            'run_query',
            'propose_rows',
            'propose_edit'
        ]);
        const [account, file, request] = ai_service.preview_rows.mock.calls[0];
        expect(account.id).toBe(ACCT);
        expect(file.id).toBe(11);
        expect(request).toEqual({ prompt: 'VIP signups', count: 3 });
        expect(res.proposed.rows).toHaveLength(3);
        expect(res.proposed.columns.map(c => c.field)).toEqual(['a', 'b']);
        expect(res.answer).toContain('3 new rows');
        expect(res.api_call).toBeNull();
        // It used one question
        expect(usage[`${ACCT}:2026-11`].questions).toBe(1);
    });

    it("says why when the rows can't be made", async () => {
        const { svc, ai_service } = setup([
            [tool_use({ count: 60, description: 'x' }, 'tu_1', 'propose_rows')]
        ]);
        ai_service.preview_rows.mockRejectedValueOnce(
            new HttpException("Only 50 of this month's 50 AI rows are left. Ask for fewer.", 429)
        );
        const res = await svc.ask(ACCT, { table: 11, question: 'add 60 rows' }, BASE);
        expect(res.answer).toContain('Only 50');
        expect(res.proposed).toBeNull();
    });

    it('sends a bad propose_rows input back to the model', async () => {
        const { svc, calls, ai_service } = setup([
            [tool_use({ count: 1000, description: 'x' }, 'tu_1', 'propose_rows')],
            [text('I can add at most 100 rows at a time.')]
        ]);
        const res = await svc.ask(ACCT, { table: 11, question: 'add 1000 rows' }, BASE);
        expect(ai_service.preview_rows).not.toHaveBeenCalled();
        expect(calls[1].messages[2].content[0]).toMatchObject({
            type: 'tool_result',
            tool_use_id: 'tu_1',
            is_error: true
        });
        expect(res.answer).toBe('I can add at most 100 rows at a time.');
    });

    it('previews an edit when asked to change rows, writing nothing (#204)', async () => {
        const { svc, calls, usage, web_file_svc } = setup([
            [
                tool_use(
                    {
                        summary: 'Upper-case the names of products over 10',
                        filters: [{ column: 'Price', op: 'gt', value: 10 }],
                        changes: [{ column: 'Name', op: 'upper' }]
                    },
                    'tu_1',
                    'propose_edit'
                )
            ]
        ]);
        const res = await svc.ask(ACCT, { table: 11, question: 'upper-case those names' }, BASE);
        expect(calls).toHaveLength(1);
        expect(calls[0].tools.map(t => t.name)).toEqual([
            'run_query',
            'propose_rows',
            'propose_edit'
        ]);
        expect(calls[0].system).toContain('propose_edit');
        expect(res.edit.columns).toEqual([{ field: 'a', name: 'Name', type: 'string' }]);
        expect(res.edit.rows).toEqual([
            { _id: String(ROWS[1]._id), before: { a: 'Lamp' }, after: { a: 'LAMP' } },
            { _id: String(ROWS[2]._id), before: { a: 'Desk' }, after: { a: 'DESK' } }
        ]);
        expect(res.edit).toMatchObject({ matching: 2, capped: false, limit: 500 });
        expect(res.answer).toContain('This changes 2 rows');
        expect(res.api_call).toBeNull();
        expect(web_file_svc.batch_update_internal).not.toHaveBeenCalled();
        expect(usage[`${ACCT}:2026-11`].questions).toBe(1);
    });

    it('sends a bad propose_edit input back to the model', async () => {
        const { svc, calls } = setup([
            [tool_use({ changes: [{ column: 'Name', op: 'eval' }] }, 'tu_1', 'propose_edit')],
            [text('I can only use the listed operations.')]
        ]);
        const res = await svc.ask(ACCT, { table: 11, question: 'run this code' }, BASE);
        expect(calls[1].messages[2].content[0]).toMatchObject({
            type: 'tool_result',
            tool_use_id: 'tu_1',
            is_error: true
        });
        expect(res.edit).toBeNull();
        expect(res.answer).toBe('I can only use the listed operations.');
    });

    it('says so when an edit changes nothing', async () => {
        const { svc } = setup([
            [tool_use({ changes: [{ column: 'Name', op: 'title' }] }, 'tu_1', 'propose_edit')]
        ]);
        const res = await svc.ask(ACCT, { table: 11, question: 'title-case names' }, BASE);
        expect(res.edit).toBeNull();
        expect(res.answer).toContain('None of the 3 rows would change');
    });

    it('refuses other tools', async () => {
        const { svc, calls } = setup([[tool_use({}, 'tu_1', 'delete_rows')], [text('No.')]]);
        await svc.ask(ACCT, { table: 11, question: 'delete everything' }, BASE);
        expect(calls[1].messages[2].content[0]).toMatchObject({ is_error: true });
    });

    it('falls back to the count when the model gives no text', async () => {
        const { svc } = setup([[tool_use({})], []]);
        const res = await svc.ask(ACCT, { table: 11, question: 'how many?' }, BASE);
        expect(res.answer).toBe('3 rows match.');
        expect(res.total).toBe(3);
    });

    it('keeps accounts apart', async () => {
        const { svc, ai_client } = setup([]);
        await expect(svc.ask(OTHER, { table: 11, question: 'q' }, BASE)).rejects.toThrow(
            ForbiddenException
        );
        await expect(svc.ask(ACCT, { table: 12, question: 'q' }, BASE)).rejects.toThrow(
            ForbiddenException
        );
        await expect(svc.ask(ACCT, { table: 13, question: 'q' }, BASE)).rejects.toThrow(
            NotFoundException
        );
        await expect(svc.ask(ACCT, { table: 99, question: 'q' }, BASE)).rejects.toThrow(
            NotFoundException
        );
        await expect(svc.ask(ACCT, { question: 'q' }, BASE)).rejects.toThrow(BadRequestException);
        expect(ai_client.create_message).not.toHaveBeenCalled();
    });

    it('counts usage per account', async () => {
        const { svc } = setup([[tool_use({})], [text('Three.')]]);
        await svc.ask(ACCT, { table: 11, question: 'how many?' }, BASE);
        expect((await svc.status(ACCT)).usage.used).toBe(1);
        expect((await svc.status(OTHER)).usage.used).toBe(0);
    });

    it('checks the question and the account lock', async () => {
        const { svc, tracking_manager, ai_client } = setup([]);
        await expect(svc.ask(ACCT, { table: 11, question: ' ' }, BASE)).rejects.toThrow(
            BadRequestException
        );
        await expect(svc.ask(ACCT, { table: 11, question: 'x'.repeat(501) }, BASE)).rejects.toThrow(
            BadRequestException
        );
        tracking_manager.check_account_lock.mockRejectedValueOnce(new ForbiddenException());
        await expect(svc.ask(ACCT, { table: 11, question: 'q' }, BASE)).rejects.toThrow(
            ForbiddenException
        );
        expect(ai_client.create_message).not.toHaveBeenCalled();
    });

    it('is off without an API key', async () => {
        const { svc } = setup([], { available: false });
        expect((await svc.status(ACCT)).available).toBe(false);
        await expect(svc.ask(ACCT, { table: 11, question: 'q' }, BASE)).rejects.toThrow(
            ServiceUnavailableException
        );
    });

    it('caps questions per plan and month', async () => {
        const { svc, usage, ai_client } = setup([], { subscription_id: 'SUB_LIVE_BASIC' });
        const limit = AI_ALLOWANCES.STARTER.questions;
        usage[`${ACCT}:2026-11`] = { questions: limit };
        const err = await svc.ask(ACCT, { table: 11, question: 'q' }, BASE).catch(e => e);
        expect(err).toBeInstanceOf(HttpException);
        expect(err.getStatus()).toBe(429);
        expect(err.message).toContain(`all ${limit} questions`);
        expect(ai_client.create_message).not.toHaveBeenCalled();
        expect((await svc.status(ACCT)).usage).toMatchObject({
            used: limit,
            limit,
            tier: 'STARTER'
        });
        // A new month starts again
        svc.now = () => Date.UTC(2026, 11, 1);
        expect((await svc.status(ACCT)).usage).toMatchObject({ used: 0, month: '2026-12' });
    });

    it("caps what an account's questions cost per month", async () => {
        // A question that used a lot of tokens: 600k input on Haiku is $0.06, over Free's $0.05
        const { svc, usage, ai_client } = setup([[tool_use({})], [text('Three.')]], {
            usage: { input_tokens: 300_000, output_tokens: 0 }
        });
        await svc.ask(ACCT, { table: 11, question: 'q' }, BASE);
        expect(usage[`${ACCT}:2026-11`].cost_micros).toBe(60_000);
        const err = await svc.ask(ACCT, { table: 11, question: 'q' }, BASE).catch(e => e);
        expect(err.getStatus()).toBe(429);
        expect(err.message).toContain('AI allowance');
        expect(ai_client.create_message).toHaveBeenCalledTimes(2);
        expect((await svc.status(ACCT)).usage).toMatchObject({ used: 1, budget_used: 1 });
    });

    it('gives an unverified account no AI', async () => {
        const { svc, ai_client } = setup([], { email_verified: false });
        expect((await svc.status(ACCT)).usage).toMatchObject({ limit: 0, verified: false });
        await expect(svc.ask(ACCT, { table: 11, question: 'q' }, BASE)).rejects.toThrow(
            ForbiddenException
        );
        expect(ai_client.create_message).not.toHaveBeenCalled();
    });

    it('pauses for everyone once the server budget is spent, and alerts on the way', async () => {
        (telegram.send_telegram as jest.Mock).mockClear();
        // Each question: 2 calls of 2.5M input tokens on Haiku = $0.50
        const replies = [[tool_use({})], [text('a')], [tool_use({})], [text('b')]];
        const { svc, server, ai_client } = setup(replies, {
            subscription_id: 'SUB_LIVE_PLUS',
            usage: { input_tokens: 2_500_000, output_tokens: 0 }
        });
        await svc.ask(ACCT, { table: 11, question: 'q1' }, BASE);
        expect(server['2026-11']).toBe(500_000);
        expect(telegram.send_telegram).toHaveBeenCalledTimes(1);
        expect((telegram.send_telegram as jest.Mock).mock.calls[0][0]).toContain('50%');
        await svc.ask(ACCT, { table: 11, question: 'q2' }, BASE);
        // Past 80% and 100% in one question: one alert each
        expect(telegram.send_telegram).toHaveBeenCalledTimes(3);
        expect((telegram.send_telegram as jest.Mock).mock.calls[2][0]).toContain('paused');

        expect((await svc.status(OTHER)).available).toBe(false);
        await expect(svc.ask(ACCT, { table: 11, question: 'q3' }, BASE)).rejects.toThrow(
            ServiceUnavailableException
        );
        expect(ai_client.create_message).toHaveBeenCalledTimes(4);
        // A new month starts again
        svc.now = () => Date.UTC(2026, 11, 1);
        expect((await svc.status(ACCT)).available).toBe(true);
    });

    it('reminds the model once to query before answering', async () => {
        const { svc, calls } = setup([[text('Probably three.')], [tool_use({})], [text('Three.')]]);
        const res = await svc.ask(ACCT, { table: 11, question: 'how many?' }, BASE);
        expect(res.answer).toBe('Three.');
        expect(res.total).toBe(3);
        expect(calls[1].messages[2]).toEqual({
            role: 'user',
            content:
                'Call run_query to read the rows before you answer, propose_rows if I asked for ' +
                'new rows, or propose_edit if I asked to change rows.'
        });
    });

    it("doesn't count a question the model never answered", async () => {
        const { svc, usage } = setup([]);
        await expect(svc.ask(ACCT, { table: 11, question: 'q' }, BASE)).rejects.toThrow(
            BadGatewayException
        );
        expect(usage[`${ACCT}:2026-11`].questions).toBe(0);
    });

    it("doesn't count a question when the sample rows can't be read", async () => {
        const { svc, ai_usage, ai_client, web_file_manager } = setup([[text('unused')]]);
        web_file_manager.query_rows.mockRejectedValueOnce(new Error('mongo timeout'));
        await expect(svc.ask(ACCT, { table: 11, question: 'q' }, BASE)).rejects.toThrow(
            'mongo timeout'
        );
        expect(ai_usage.reserve).not.toHaveBeenCalled();
        expect(ai_client.create_message).not.toHaveBeenCalled();
    });
});
