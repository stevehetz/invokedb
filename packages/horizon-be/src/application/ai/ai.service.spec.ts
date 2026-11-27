import {
    BadGatewayException,
    BadRequestException,
    ForbiddenException,
    HttpException,
    NotFoundException,
    ServiceUnavailableException
} from '@nestjs/common';
import { AiService } from './ai.service';
import { AI_LIMITS } from '@app/core/ai/ai';
import { AI_ALLOWANCES, AI_OFF_MESSAGE } from '@app/core/ai/ai-plan';
import { AiSpend } from '@app/core/ai/ai-spend';
import { AiModelError } from '@app/core/ai/ai-client';

jest.mock('@app/logger', () => ({
    __esModule: true,
    default: { error: jest.fn(), info: jest.fn(), warn: jest.fn() }
}));
// Stand-ins below; the real ones pull in TypeORM, ESM-only packages and the Anthropic SDK
jest.mock('../file-directory/file-directory.service', () => ({}));
jest.mock('../account/account.service', () => ({}));
jest.mock('../table-template/table-template.service', () => ({}));
jest.mock('../../core/ai/ai-client', () => ({
    AiClient: class {},
    AiModelError: class extends Error {
        constructor(
            message: string,
            readonly usage?: any,
            readonly model?: string
        ) {
            super(message);
        }
    }
}));
jest.mock('../../core/telegram/telegram', () => ({
    telegram_configured: () => false,
    send_telegram: jest.fn()
}));

const ACCT = 7; // Free: 50 rows a month
const OTHER = 8; // Plus → Pro: 10,000
const UNVERIFIED = 9;
const NOW = Date.UTC(2026, 10, 25);
const FREE_ROWS = AI_ALLOWANCES.FREE.rows;
// What each stub call used: 1,000 input and 1,000 output tokens on Haiku = 600 micro-dollars
const CALL_USAGE = { input_tokens: 1000, output_tokens: 1000 };

const STUB_COLUMNS = [
    { name: 'Name', type: 'string' },
    { name: 'Amount', type: 'number' },
    { name: 'Date', type: 'date' }
];

/** Made-up answers that fit the schema: a design, or `n` rows of the schema's columns. */
function stub_answer(schema: any, n: number) {
    const props = schema.properties || {};
    if (props.columns) return { table_name: 'stub_table', columns: STUB_COLUMNS };
    const item = props.rows.items.properties;
    const rows = [];
    for (let i = 0; i < n; i++) {
        const row = {};
        Object.keys(item).forEach(field => {
            const typed = item[field].anyOf[0];
            const label = String(item[field].description).split(' (')[0];
            if (typed.type === 'number') row[field] = i + 1;
            else if (typed.format === 'date') row[field] = `2026-01-0${(i % 9) + 1}`;
            else row[field] = `${label} ${i + 1}`;
        });
        rows.push(row);
    }
    return { rows };
}

// The rows a prompt asks for ("Generate exactly N new rows.")
const asked = (prompt: string) => Number((/exactly (\d+) new rows/.exec(prompt) || [])[1] || 0);

// The rows of the account's crm_contacts table (#324)
const CONTACTS = [
    { _id: 'r1', e: 'ada@acme.test', n: 'Ada' },
    { _id: 'r2', e: 'bea@acme.test', n: 'Bea' },
    { _id: 'r3', e: 'cy@acme.test', n: 'Cy' }
];
// The rows of another account's table: never read
const THEIRS = [{ _id: 't1', e: 'secret@theirs.test', n: 'Them' }];

function setup(
    opts: {
        available?: boolean;
        budget?: number;
        // With the account's own named tables (#324): crm_contacts, and demo8's theirs_secret
        tables?: boolean;
        // Scripted replies of the design's tool loop (#324)
        replies?: any[][];
    } = {}
) {
    const files = {
        11: { id: 11, account_id: ACCT, type: 'file', deleted: false },
        12: { id: 12, account_id: OTHER, type: 'file', deleted: false },
        13: { id: 13, account_id: ACCT, type: 'file', deleted: true },
        ...(opts.tables
            ? {
                  21: {
                      id: 21,
                      account_id: ACCT,
                      name: 'crm_contacts',
                      type: 'file',
                      deleted: false
                  },
                  22: {
                      id: 22,
                      account_id: OTHER,
                      name: 'theirs_secret',
                      type: 'file',
                      deleted: false
                  },
                  23: { id: 23, account_id: ACCT, name: 'old_list', type: 'file', deleted: true }
              }
            : {})
    };
    const rows_of = (file_id: unknown) => (Number(file_id) === 22 ? THEIRS : CONTACTS);
    const accounts = {
        [ACCT]: { id: ACCT, subscription_id: 'SUB_FREE', email_verified: true },
        [OTHER]: { id: OTHER, subscription_id: 'SUB_LIVE_PLUS', email_verified: true },
        [UNVERIFIED]: { id: UNVERIFIED, subscription_id: 'SUB_FREE', email_verified: false }
    };
    const file_directory_svc = {
        assert_owned: jest.fn(async (acct, id) => {
            const f = files[Number(id)];
            if (!f) throw new NotFoundException();
            if (f.account_id !== acct) throw new ForbiddenException();
            return f;
        }),
        // Only the named tables (#324) are listed: the others stand for an account with none
        get_by_account_id: jest.fn(async acct =>
            Object.values(files).filter((f: any) => f.name && f.account_id === acct && !f.deleted)
        )
    };
    const account_svc = { get: jest.fn(async id => accounts[id] || null) };
    const table_template_svc = {
        create_from: jest.fn(async (_acct: number, _template: any, _body: any) => 99)
    };
    const tracking_manager = {
        check_account_lock: jest.fn(async () => undefined),
        check_not_read_only: jest.fn(async () => undefined),
        check_table_lock: jest.fn(async () => undefined)
    };
    const web_file_manager = {
        get_columns: jest.fn(async (_acct?: any, file_id?: any): Promise<any[]> =>
            [21, 22].includes(Number(file_id))
                ? [
                      { field: 'e', headerName: 'Email', order: 1 },
                      { field: 'n', headerName: 'Name', order: 2 }
                  ]
                : [
                      { field: 'a', headerName: 'Name', order: 1 },
                      { field: 'b', headerName: 'Age', col_type: 'number', order: 2 },
                      { field: 'c', headerName: 'Owner', col_type: 'link', order: 3 }
                  ]
        ),
        first_rows: jest.fn(async () => [{ _id: 'x', a: 'Ada', b: 36, c: ['id'] }]),
        // Reads of the account's tables (#324): every row, up to the limit
        query_rows: jest.fn(async (_acct, file_id, query) => ({
            docs: rows_of(file_id).slice(0, query.limit + 1),
            explain: null
        })),
        count_rows: jest.fn(async (_acct, file_id) => rows_of(file_id).length),
        format_date_field: jest.fn(v => v)
    };
    // The design's tool loop (#324): scripted replies, and what each call was sent
    const replies = [...(opts.replies || [])];
    const messages_sent: any[] = [];
    // Never the real model
    const answer = jest.fn(async (req: any): Promise<any> =>
        stub_answer(req.schema, asked(req.prompt))
    );
    const ai_client = {
        available: jest.fn(() => opts.available !== false),
        budget_micros: jest.fn(() => opts.budget || 20_000_000),
        json: jest.fn(async (req: any) => ({
            data: await answer(req),
            usage: CALL_USAGE,
            model: 'claude-haiku-5-5'
        })),
        create_message: jest.fn(async (params: any) => {
            messages_sent.push(JSON.parse(JSON.stringify(params)));
            const content = replies.shift();
            if (!content) throw new Error('no more replies');
            return { reply: { content, usage: CALL_USAGE }, model: 'claude-haiku-5-5' };
        })
    };
    const usage: Record<string, any> = {};
    const server: Record<string, number> = {};
    const key = (acct, month) => `${acct}:${month}`;
    const doc = (acct, month) =>
        (usage[key(acct, month)] = usage[key(acct, month)] || { rows: 0, cost_micros: 0 });
    const ai_usage = {
        get: jest.fn(async (acct, month) => ({
            month,
            questions: 0,
            rows: 0,
            input_tokens: 0,
            output_tokens: 0,
            cost_micros: 0,
            ...usage[key(acct, month)]
        })),
        reserve_rows: jest.fn(async (acct, month, rows, allowance, budget) => {
            const u = doc(acct, month);
            if (!(rows <= allowance) || u.rows + rows > allowance || u.cost_micros >= budget) {
                return false;
            }
            u.rows += rows;
            return true;
        }),
        release_rows: jest.fn(async (acct, month, rows) => {
            if (rows > 0) doc(acct, month).rows -= rows;
        }),
        add_usage: jest.fn(async (acct, month, _i, _o, c) => {
            doc(acct, month).cost_micros += c;
        }),
        server_cost: jest.fn(async month => server[month] || 0),
        add_server_cost: jest.fn(async (month, c) => {
            const before = server[month] || 0;
            server[month] = before + c;
            return { before, after: server[month] };
        })
    };
    const svc = new AiService(
        file_directory_svc as any,
        account_svc as any,
        table_template_svc as any,
        tracking_manager as any,
        web_file_manager as any,
        ai_client as any,
        ai_usage as any,
        new AiSpend(ai_client as any, ai_usage as any)
    );
    svc.now = () => NOW;
    const used = (acct = ACCT) => (usage[key(acct, '2026-11')] || { rows: 0 }).rows;
    const cost = (acct = ACCT) => (usage[key(acct, '2026-11')] || { cost_micros: 0 }).cost_micros;
    return {
        svc,
        model: ai_client,
        answer,
        used,
        cost,
        usage,
        server,
        table_template_svc,
        tracking_manager,
        web_file_manager,
        messages_sent
    };
}

function tool_use(name: string, input: any, id = `tu_${name}`) {
    return { type: 'tool_use', id, name, input };
}

// The last tool result sent to the model, of the nth create_message call
function result_of(sent: any[], n: number) {
    return sent[n].messages.at(-1).content.find(c => c.type === 'tool_result');
}

const FOLLOW_UPS = {
    table_name: 'follow_ups',
    columns: [
        { name: 'Email', type: 'string' },
        { name: 'Status', type: 'string' },
        { name: 'Due', type: 'date' }
    ]
};

async function status_of(p: Promise<unknown>) {
    try {
        await p;
    } catch (ex) {
        return ex instanceof HttpException ? ex.getStatus() : ex;
    }
    return 200;
}

describe('AiService', () => {
    it('answers 503 on every route when AI is off, but reports its usage', async () => {
        const { svc, model } = setup({ available: false });
        await expect(svc.generate_rows(ACCT, 11, { prompt: 'x' })).rejects.toThrow(
            ServiceUnavailableException
        );
        await expect(svc.preview_table(ACCT, { description: 'x' })).rejects.toThrow(AI_OFF_MESSAGE);
        await expect(svc.create_table(ACCT, {})).rejects.toThrow(ServiceUnavailableException);
        const status = await svc.status(ACCT);
        expect(status.rows).toEqual({ month: '2026-11', used: 0, limit: FREE_ROWS });
        expect(status.limits.max_rows_per_request).toBe(AI_LIMITS.max_rows_per_request);
        expect(model.json).not.toHaveBeenCalled();
    });

    it('refuses an unverified account on every route, before any model call', async () => {
        const { svc, model, used, table_template_svc } = setup();
        expect(await status_of(svc.generate_rows(UNVERIFIED, 11, { prompt: 'x' }))).toBe(403);
        expect(await status_of(svc.preview_table(UNVERIFIED, { description: 'x' }))).toBe(403);
        expect(
            await status_of(
                svc.create_table(UNVERIFIED, {
                    table_name: 'T',
                    columns: [{ name: 'A', type: 'string' }]
                })
            )
        ).toBe(403);
        expect(model.json).not.toHaveBeenCalled();
        expect(table_template_svc.create_from).not.toHaveBeenCalled();
        expect(used(UNVERIFIED)).toBe(0);
        expect((await svc.status(UNVERIFIED)).rows.limit).toBe(0);
    });

    it('generates rows of the column types, not links, and counts and charges them', async () => {
        const { svc, model, used, cost } = setup();
        const res = await svc.generate_rows(ACCT, '11', { prompt: 'people', count: 3 });
        expect(res.rows).toEqual([
            { a: 'Name 1', b: 1 },
            { a: 'Name 2', b: 2 },
            { a: 'Name 3', b: 3 }
        ]);
        expect(res.columns.map(c => c.field)).toEqual(['a', 'b']);
        expect(used()).toBe(3);
        expect(res.usage).toEqual({ month: '2026-11', used: 3, limit: FREE_ROWS });
        // One Haiku call of 1,000 + 1,000 tokens
        expect(cost()).toBe(600);
        const req = model.json.mock.calls[0][0];
        expect(req.prompt).toContain('{"a":"Ada","b":36}');
        expect(req.prompt).toContain('people');
        expect(req.prompt).not.toContain('Owner');
    });

    it('reserves as many rows as are left, up to a cap (#207), and hands them back', async () => {
        const { svc, used } = setup();
        const account = { id: ACCT, subscription_id: 'SUB_FREE', email_verified: true };
        expect(await svc.reserve_up_to(account, 200)).toEqual({
            month: '2026-11',
            rows: FREE_ROWS
        });
        expect(used()).toBe(FREE_ROWS);
        expect(await status_of(svc.reserve_up_to(account, 200))).toBe(429);
        await svc.release_rows(account, '2026-11', FREE_ROWS - 3);
        expect(await svc.reserve_up_to(account, 2)).toEqual({ month: '2026-11', rows: 2 });
        expect(used()).toBe(5);
    });

    it("checks and counts rows Ask's model gave itself (#322), with no model call", async () => {
        const { svc, model, used, tracking_manager } = setup();
        const account = { id: ACCT, subscription_id: 'SUB_FREE', email_verified: true };
        const file = { id: 11 };
        const res = await svc.given_rows(account, file, [
            { Name: 'ada@example.com', Age: 36, Owner: ['x'], Extra: 'dropped' },
            // Values of the wrong type are made null
            { Name: 'bea@example.com', Age: 'old' },
            // Nothing usable: left out, not counted
            { Nope: 1 }
        ]);
        expect(res.rows).toEqual([
            { a: 'ada@example.com', b: 36 },
            { a: 'bea@example.com', b: null }
        ]);
        expect(res.columns.map(c => c.field)).toEqual(['a', 'b']);
        expect(used()).toBe(2);
        expect(res.usage.used).toBe(2);
        expect(model.json).not.toHaveBeenCalled();
        expect(tracking_manager.check_table_lock).toHaveBeenCalledWith(11);
        // None usable: 400, nothing counted
        expect(await status_of(svc.given_rows(account, file, [{ Nope: 1 }]))).toBe(400);
        expect(used()).toBe(2);
        // Over the month's rows: 429
        const many = Array.from({ length: FREE_ROWS }, (_, i) => ({ Name: `p${i}` }));
        expect(await status_of(svc.given_rows(account, file, many))).toBe(429);
        expect(used()).toBe(2);
    });

    it('splits a big request into several model calls', async () => {
        const { svc, model, used } = setup();
        const res = await svc.generate_rows(OTHER, 12, { prompt: 'x', count: 60 });
        expect(res.rows).toHaveLength(60);
        expect(model.json).toHaveBeenCalledTimes(Math.ceil(60 / AI_LIMITS.rows_per_call));
        expect(used(OTHER)).toBe(60);
    });

    it("refuses another account's table, a deleted one and a bad request", async () => {
        const { svc, model, used } = setup();
        expect(await status_of(svc.generate_rows(ACCT, 12, { prompt: 'x' }))).toBe(403);
        expect(await status_of(svc.generate_rows(ACCT, 13, { prompt: 'x' }))).toBe(404);
        expect(await status_of(svc.generate_rows(ACCT, 404, { prompt: 'x' }))).toBe(404);
        expect(await status_of(svc.generate_rows(ACCT, 11, { prompt: '' }))).toBe(400);
        expect(await status_of(svc.generate_rows(ACCT, 11, { prompt: 'x', count: 501 }))).toBe(400);
        expect(model.json).not.toHaveBeenCalled();
        expect(used()).toBe(0);
    });

    it('checks the account and table locks', async () => {
        const { svc, tracking_manager, model } = setup();
        tracking_manager.check_table_lock.mockRejectedValueOnce(new ForbiddenException('locked'));
        expect(await status_of(svc.generate_rows(ACCT, 11, { prompt: 'x' }))).toBe(403);
        tracking_manager.check_account_lock.mockRejectedValueOnce(new ForbiddenException('l'));
        expect(await status_of(svc.preview_table(ACCT, { description: 'x' }))).toBe(403);
        expect(model.json).not.toHaveBeenCalled();
    });

    it('needs a column to fill', async () => {
        const { svc, web_file_manager } = setup();
        web_file_manager.get_columns.mockResolvedValueOnce([]);
        await expect(svc.generate_rows(ACCT, 11, { prompt: 'x' })).rejects.toThrow(
            BadRequestException
        );
    });

    it('caps the month per tier, and accounts are counted apart', async () => {
        const { svc, model, used } = setup();
        await svc.generate_rows(ACCT, 11, { prompt: 'x', count: FREE_ROWS });
        expect(used()).toBe(FREE_ROWS);
        const calls = model.json.mock.calls.length;
        expect(await status_of(svc.generate_rows(ACCT, 11, { prompt: 'x', count: 1 }))).toBe(429);
        await expect(svc.preview_table(ACCT, { description: 'x' })).rejects.toThrow(/used up/);
        expect(model.json.mock.calls.length).toBe(calls);
        // The other account (Pro) is untouched
        expect((await svc.status(OTHER)).rows).toEqual({
            month: '2026-11',
            used: 0,
            limit: AI_ALLOWANCES.PRO.rows
        });
        // A new month starts again
        svc.now = () => Date.UTC(2026, 11, 1);
        expect((await svc.status(ACCT)).rows.used).toBe(0);
    });

    it('says how many rows are left when a request is too big for them', async () => {
        const { svc } = setup();
        await svc.generate_rows(ACCT, 11, { prompt: 'x', count: FREE_ROWS - 5 });
        await expect(svc.generate_rows(ACCT, 11, { prompt: 'x', count: 10 })).rejects.toThrow(
            new RegExp(`Only 5 of this month's ${FREE_ROWS}`)
        );
    });

    it("stops at the account's dollar budget, rows left or not", async () => {
        const { svc, usage, model } = setup();
        usage[`${ACCT}:2026-11`] = { rows: 0, cost_micros: 50_000 };
        const err = await svc.generate_rows(ACCT, 11, { prompt: 'x', count: 1 }).catch(e => e);
        expect(err.getStatus()).toBe(429);
        expect(err.message).toContain('AI allowance');
        expect(model.json).not.toHaveBeenCalled();
    });

    it('pauses once the server budget is spent', async () => {
        const { svc, server, model } = setup({ budget: 1000 });
        await svc.generate_rows(ACCT, 11, { prompt: 'x', count: 2 });
        expect(server['2026-11']).toBe(600);
        await svc.generate_rows(ACCT, 11, { prompt: 'x', count: 2 });
        expect(await status_of(svc.generate_rows(ACCT, 11, { prompt: 'x', count: 2 }))).toBe(503);
        expect(model.json).toHaveBeenCalledTimes(2);
    });

    it('counts every row asked of the model, and charges every call, even failed ones', async () => {
        const { svc, answer, used, cost } = setup();
        answer.mockResolvedValueOnce({ rows: [{ a: 'only one' }] });
        const res = await svc.generate_rows(ACCT, 11, { prompt: 'x', count: 5 });
        expect(res.rows).toHaveLength(1);
        expect(used()).toBe(5);
        expect(cost()).toBe(600);

        answer.mockRejectedValueOnce(new Error('overloaded'));
        expect(await status_of(svc.generate_rows(ACCT, 11, { prompt: 'x', count: 5 }))).toBe(502);
        expect(used()).toBe(10);
        // A declined call is paid for
        answer.mockRejectedValueOnce(
            new AiModelError('The AI declined this request', CALL_USAGE as any, 'claude-haiku-5-5')
        );
        await expect(svc.generate_rows(ACCT, 11, { prompt: 'x', count: 5 })).rejects.toThrow(
            /declined/
        );
        answer.mockResolvedValueOnce({ rows: [] });
        await expect(svc.generate_rows(ACCT, 11, { prompt: 'x', count: 5 })).rejects.toThrow(
            BadGatewayException
        );
        expect(used()).toBe(20);
    });

    it('keeps the rows of the calls that worked when one fails', async () => {
        const { svc, answer, used } = setup();
        answer.mockImplementationOnce(async () => {
            throw new Error('cut off');
        });
        const res = await svc.generate_rows(OTHER, 12, { prompt: 'x', count: 60 });
        expect(res.rows).toHaveLength(60 - AI_LIMITS.rows_per_call);
        expect(used(OTHER)).toBe(60);
    });

    it('hands back rows of calls never started after a failure', async () => {
        const { svc, answer, model, used } = setup();
        const parallel = AI_LIMITS.parallel_calls;
        (AI_LIMITS as any).parallel_calls = 1;
        try {
            answer.mockRejectedValueOnce(new Error('cut off'));
            expect(await status_of(svc.generate_rows(OTHER, 12, { prompt: 'x', count: 60 }))).toBe(
                502
            );
            expect(model.json).toHaveBeenCalledTimes(1);
            expect(used(OTHER)).toBe(AI_LIMITS.rows_per_call);
        } finally {
            (AI_LIMITS as any).parallel_calls = parallel;
        }
    });

    it('previews a table from a description, rows keyed by column name', async () => {
        const { svc, model, used } = setup();
        const res = await svc.preview_table(ACCT, { description: 'a CRM', row_count: 2 });
        expect(res.table_name).toBe('stub_table');
        expect(res.columns).toEqual([
            { name: 'Name', type: 'string' },
            { name: 'Amount', type: 'number' },
            { name: 'Date', type: 'date' }
        ]);
        expect(res.rows).toEqual([
            { Name: 'Name 1', Amount: 1, Date: '2026-01-01' },
            { Name: 'Name 2', Amount: 2, Date: '2026-01-02' }
        ]);
        expect(model.json).toHaveBeenCalledTimes(2);
        expect(used()).toBe(2);
        expect(res.usage.used).toBe(2);
    });

    it('counts a design as one row, failed or not, and its rows as asked', async () => {
        const { svc, answer, model, used } = setup();
        await svc.preview_table(ACCT, { description: 'x', row_count: 0 });
        expect(model.json).toHaveBeenCalledTimes(1);
        expect(used()).toBe(1);
        answer.mockResolvedValueOnce({ table_name: 'x', columns: [] });
        expect(await status_of(svc.preview_table(ACCT, { description: 'x', row_count: 5 }))).toBe(
            400
        );
        expect(used()).toBe(2);
        answer.mockRejectedValueOnce(new Error('down'));
        expect(await status_of(svc.preview_table(ACCT, { description: 'x', row_count: 5 }))).toBe(
            502
        );
        expect(used()).toBe(3);
        // The design works but its rows fail: the rows asked for count
        answer.mockImplementationOnce(async (req: any) => stub_answer(req.schema, 0));
        answer.mockRejectedValueOnce(new Error('cut off'));
        expect(await status_of(svc.preview_table(ACCT, { description: 'x', row_count: 5 }))).toBe(
            502
        );
        expect(used()).toBe(8);
    });

    it("copies rows from a table it read (#324): the account's real values, counted", async () => {
        const { svc, model, used, cost, messages_sent } = setup({
            tables: true,
            replies: [
                [tool_use('run_query', { table: 'CRM_Contacts', fields: ['Email'] })],
                [
                    tool_use('propose_table', {
                        ...FOLLOW_UPS,
                        rows: [
                            { Email: 'ada@acme.test', Status: null },
                            // A key the design's name was made from still fills it
                            { 'e-mail!?': 'nope', 'Email ': 'bea@acme.test' },
                            { email: 'cy@acme.test', Due: 'not a date' },
                            // Nothing usable: dropped, not counted
                            { Other: 'x' }
                        ]
                    })
                ]
            ]
        });
        const res = await svc.preview_table(ACCT, {
            description: 'A table of follow-ups for the emails in crm_contacts',
            row_count: 20
        });
        expect(res.table_name).toBe('follow_ups');
        expect(res.columns).toEqual(FOLLOW_UPS.columns);
        expect(res.rows).toEqual([
            { Email: 'ada@acme.test', Status: null, Due: null },
            { Email: 'bea@acme.test', Status: null, Due: null },
            { Email: 'cy@acme.test', Status: null, Due: null }
        ]);
        expect(res.read).toEqual(['crm_contacts']);
        // The rows kept count (not the 20 asked for), the read costs none; two calls charged
        expect(used()).toBe(3);
        expect(res.usage.used).toBe(3);
        expect(cost()).toBe(1200);
        expect(model.json).not.toHaveBeenCalled();
        // The design call knew the account's own tables, and only those
        expect(messages_sent[0].system).toContain('"crm_contacts": "Email" (string), "Name"');
        expect(messages_sent[0].system).toContain('at most 20 rows');
        expect(messages_sent[0].system).not.toContain('theirs_secret');
        expect(messages_sent[0].system).not.toContain('old_list');
        expect(messages_sent[0].tools.map(t => t.name)).toEqual(['run_query', 'propose_table']);
        expect(messages_sent[0].tools[0].input_schema.required).toEqual(['table']);
        expect(messages_sent[0].tools[0].input_schema.properties.limit.maximum).toBe(100);
        const read = result_of(messages_sent, 1);
        expect(read.is_error).toBeUndefined();
        expect(read.content).toContain('ada@acme.test');
    });

    it("can't read another account's tables (#324), and generates rows without one", async () => {
        const { svc, model, used, messages_sent, web_file_manager } = setup({
            tables: true,
            replies: [
                [tool_use('run_query', { table: 'theirs_secret' })],
                // A table that was deleted reads as missing too
                [tool_use('run_query', { table: 'old_list' })],
                [tool_use('propose_table', FOLLOW_UPS)]
            ]
        });
        const res = await svc.preview_table(ACCT, {
            description: 'follow-ups for theirs_secret',
            row_count: 2
        });
        for (const n of [1, 2]) {
            const r = result_of(messages_sent, n);
            expect(r.is_error).toBe(true);
            expect(r.content).toContain('no table named');
        }
        expect(JSON.stringify(messages_sent)).not.toContain('secret@theirs.test');
        expect(web_file_manager.query_rows).not.toHaveBeenCalled();
        expect(res.read).toEqual([]);
        // No rows given: generated as before, from the design's columns
        expect(res.rows).toEqual([
            { Email: 'Email 1', Status: 'Status 1', Due: '2026-01-01' },
            { Email: 'Email 2', Status: 'Status 2', Due: '2026-01-02' }
        ]);
        expect(model.json).toHaveBeenCalledTimes(1);
        expect(used()).toBe(2);
    });

    it('designs from the description alone when it names no table (#324)', async () => {
        const { svc, model, used, messages_sent } = setup({
            tables: true,
            replies: [
                // No tool call: reminded once
                [{ type: 'text', text: 'Sure!' }],
                [tool_use('propose_table', { table_name: 'x', columns: [] })],
                [tool_use('propose_table', { ...FOLLOW_UPS, rows: [{ Other: 1 }] })],
                [tool_use('propose_table', FOLLOW_UPS)]
            ]
        });
        const res = await svc.preview_table(ACCT, { description: 'a CRM', row_count: 3 });
        expect(messages_sent[1].messages.at(-1).content).toContain('propose_table');
        // A design with no columns, and rows that fit none of them, go back as tool errors
        expect(result_of(messages_sent, 2).content).toMatch(/usable columns/);
        expect(result_of(messages_sent, 3).content).toMatch(/None of the rows/);
        expect(res.rows).toHaveLength(3);
        expect(model.json).toHaveBeenCalledTimes(1);
        expect(used()).toBe(3);
    });

    it('keeps no rows when none were asked for, and 502s with no design (#324)', async () => {
        const rows = [{ Email: 'ada@acme.test' }];
        const { svc, used, model } = setup({
            tables: true,
            replies: [
                [tool_use('propose_table', { ...FOLLOW_UPS, rows })],
                ...Array.from({ length: 4 }, () => [tool_use('run_query', { table: 'nope' })])
            ]
        });
        const res = await svc.preview_table(ACCT, { description: 'x', row_count: 0 });
        expect(res.rows).toEqual([]);
        expect(used()).toBe(1);
        expect(await status_of(svc.preview_table(ACCT, { description: 'x', row_count: 5 }))).toBe(
            502
        );
        // The design counts as one row, failed or not
        expect(used()).toBe(2);
        // The model failing to answer is a 502 too
        expect(await status_of(svc.preview_table(ACCT, { description: 'x', row_count: 5 }))).toBe(
            502
        );
        expect(used()).toBe(3);
        expect(model.json).not.toHaveBeenCalled();
    });

    it('creates a previewed table like a template', async () => {
        const { svc, table_template_svc } = setup();
        const id = await svc.create_table(ACCT, {
            table_name: 'pets',
            columns: [
                { name: 'Name', type: 'string' },
                { name: 'Born', type: 'date' }
            ],
            rows: [{ Name: 'Rex', Born: '2020-01-02' }],
            parent_id: 5
        });
        expect(id).toBe(99);
        const [acct, template, body] = table_template_svc.create_from.mock.calls[0];
        expect(acct).toBe(ACCT);
        expect(template.columns).toHaveLength(2);
        expect(template.rows).toEqual([{ Name: 'Rex', Born: '2020-01-02' }]);
        expect(body).toEqual({ name: 'pets', parent_id: 5 });
    });

    it('refuses a table that a template could not be', async () => {
        const { svc, table_template_svc } = setup();
        const bad = [
            { table_name: 'bad name', columns: [{ name: 'A', type: 'string' }] },
            { table_name: 'ok', columns: [] },
            { table_name: 'ok', columns: [{ name: 'A', type: 'link' }] },
            { table_name: 'ok', columns: [{ name: 'A', type: 'number' }], rows: [{ A: 'x' }] },
            { table_name: 'ok', columns: [{ name: 'A', type: 'string' }], rows: [{ B: 'x' }] },
            {
                table_name: 'ok',
                columns: Array.from({ length: 31 }, (_, i) => ({ name: `c${i}`, type: 'string' }))
            }
        ];
        for (const body of bad) {
            expect(await status_of(svc.create_table(ACCT, body))).toBe(400);
        }
        await expect(svc.create_table(ACCT, bad[0])).rejects.toThrow(/table_name/);
        await expect(svc.create_table(ACCT, bad[0])).rejects.not.toThrow(/Template/);
        expect(table_template_svc.create_from).not.toHaveBeenCalled();
    });
});
