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
import { ASK_MAX_TURNS } from '@app/core/ai/ask';
import { AI_ALLOWANCES } from '@app/core/ai/ai-plan';
import * as telegram from '@app/core/telegram/telegram';

// Stand-ins below; the real ones pull in TypeORM, ESM-only packages and the Anthropic SDK.
// The model is never called: every reply is scripted.
jest.mock('../file-directory/file-directory.service', () => ({}));
jest.mock('../account/account.service', () => ({}));
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
    } = {}
) {
    const files = {
        11: { id: 11, account_id: ACCT, name: 'Products', type: 'file', deleted: false },
        12: { id: 12, account_id: OTHER, name: 'Theirs', type: 'file', deleted: false },
        13: { id: 13, account_id: ACCT, name: 'Gone', type: 'file', deleted: true }
    };
    const file_directory_svc = {
        assert_owned: jest.fn(async (acct, id) => {
            const f = files[Number(id)];
            if (!f) throw new NotFoundException();
            if (f.account_id !== acct) throw new ForbiddenException();
            return f;
        })
    };
    const account_svc = {
        get: jest.fn(async id => ({
            id,
            subscription_id: opts.subscription_id || null,
            email_verified: opts.email_verified !== false
        }))
    };
    const tracking_manager = { check_account_lock: jest.fn(async () => undefined) };
    const web_file_manager = {
        get_columns: jest.fn(async () => [
            { field: 'a', headerName: 'Name' },
            { field: 'b', headerName: 'Price', col_type: 'number' }
        ]),
        // A tiny Mongo: $and of { field: { $gt } } conditions, sorted by the first sort key
        query_rows: jest.fn(async (_acct, _file, query) => {
            let docs = ROWS.filter(r => matches(r, query.filter));
            const key = query.sort[0];
            if (key.field !== '_id') {
                docs = [...docs].sort((x, y) => (x[key.field] - y[key.field]) * key.dir);
            }
            return { docs: docs.slice(0, query.limit + 1), explain: null };
        }),
        count_rows: jest.fn(
            async (_acct, _file, query) => ROWS.filter(r => matches(r, query.filter)).length
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
    const svc = new AskService(
        file_directory_svc as any,
        account_svc as any,
        tracking_manager as any,
        web_file_manager as any,
        ai_client as any,
        ai_usage as any
    );
    svc.now = () => NOW;
    return { svc, calls, usage, server, ai_client, ai_usage, web_file_manager, tracking_manager };
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
            content: 'Call run_query to read the rows before you answer.'
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
