import { HttpException, HttpStatus, NotFoundException } from '@nestjs/common';
import { ImportTextService } from './import-text.service';
import { AiModelError } from '@app/core/ai/ai-client';
import { IMPORT_LIMITS } from '@app/core/ai/import-text';

// Stand-ins; the real ones pull in TypeORM, ESM-only packages and the Anthropic SDK. The model
// is never called: its answers are scripted.
jest.mock('@app/logger', () => ({
    __esModule: true,
    default: { error: jest.fn(), info: jest.fn(), warn: jest.fn() }
}));
jest.mock('../account/account.service', () => ({}));
jest.mock('./ask.service', () => ({}));
jest.mock('./ai.service', () => ({}));
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

const ACCT = 7;
const OTHER = 8;
const TEXT = 'Orders:\nAda Lovelace, 12\nGrace Hopper, 30 (paid)\nTotal 42';

function setup(opts: { verified?: boolean; available?: boolean; rows_left?: number } = {}) {
    const files = {
        11: { id: 11, account_id: ACCT, name: 'orders', type: 'file', deleted: false },
        12: { id: 12, account_id: OTHER, name: 'theirs', type: 'file', deleted: false }
    };
    const account_svc = {
        get: jest.fn(async id => ({ id, email_verified: opts.verified !== false }))
    };
    const tracking_manager = {
        check_account_lock: jest.fn(async () => undefined),
        check_not_read_only: jest.fn(async () => undefined),
        check_table_lock: jest.fn(async () => undefined)
    };
    const web_file_manager = {
        get_columns: jest.fn(async () => [
            { field: 'a', headerName: 'Name' },
            { field: 'b', headerName: 'Qty', col_type: 'number' },
            { field: 'c', headerName: 'Customer', col_type: 'link' }
        ])
    };
    let answer: any = {
        rows: [
            { a: 'Ada Lovelace', b: 12 },
            { a: 'Grace Hopper', b: '30' }
        ]
    };
    const ai_client = {
        available: jest.fn(() => opts.available !== false),
        json: jest.fn(async (_req: any): Promise<any> => {
            if (answer instanceof Error) throw answer;
            return { data: answer, usage: { input_tokens: 100, output_tokens: 10 }, model: 'm' };
        })
    };
    const ai_spend = { charge: jest.fn(async () => 0) };
    // The month's counts: questions and AI rows
    const count = { questions: 0, rows: 0 };
    const limit = { questions: 20, rows: opts.rows_left ?? 1000 };
    const ai_usage = { release: jest.fn(async () => void count.questions--) };
    const too_many = (m: string) => new HttpException(m, HttpStatus.TOO_MANY_REQUESTS);
    const ai_service = {
        reserve_up_to: jest.fn(async (_account, max: number) => {
            const rows = Math.max(1, Math.min(max, limit.rows - count.rows));
            if (count.rows + rows > limit.rows) throw too_many('rows used up');
            count.rows += rows;
            return { month: '2026-11', rows };
        }),
        release_rows: jest.fn(async (_account, _month, rows: number) => {
            if (rows > 0) count.rows -= rows;
        }),
        rows_usage: jest.fn(async () => ({ used: count.rows, limit: limit.rows }))
    };
    const ask_service = {
        owned_table: jest.fn(async (acct, id) => {
            const f = files[Number(id)];
            if (!f || f.account_id !== acct) throw new NotFoundException();
            return f;
        }),
        reserve_question: jest.fn(async () => {
            if (count.questions >= limit.questions) throw too_many('questions used up');
            count.questions++;
            return '2026-11';
        }),
        usage: jest.fn(async () => ({ used: count.questions, limit: limit.questions }))
    };
    const svc = new ImportTextService(
        account_svc as any,
        tracking_manager as any,
        web_file_manager as any,
        ai_client as any,
        ai_usage as any,
        ai_spend as any,
        ai_service as any,
        ask_service as any
    );
    return {
        svc,
        ai_client,
        ai_spend,
        count,
        limit,
        tracking_manager,
        set_answer: (a: any) => (answer = a)
    };
}

async function status_of(p: Promise<unknown>) {
    try {
        await p;
    } catch (ex) {
        return ex instanceof HttpException ? ex.getStatus() : ex;
    }
    return 200;
}

describe('ImportTextService.preview', () => {
    it('turns the text into rows to review, using one question and the rows made', async () => {
        const t = setup();
        const res = await t.svc.preview(ACCT, '11', { text: TEXT });
        expect(res.proposed.rows).toEqual([
            { a: 'Ada Lovelace', b: 12 },
            { a: 'Grace Hopper', b: 30 }
        ]);
        // No link columns
        expect(res.proposed.columns.map(c => c.field)).toEqual(['a', 'b']);
        expect(res.answer).toMatch(/^Here are 2 rows/);
        expect(res.capped).toBe(false);
        expect(t.count).toEqual({ questions: 1, rows: 2 });
        expect(res.usage.used).toBe(1);
        expect(res.rows_usage.used).toBe(2);
        expect(t.ai_spend.charge).toHaveBeenCalledTimes(1);
        expect(t.tracking_manager.check_table_lock).toHaveBeenCalledWith(11);

        const req = t.ai_client.json.mock.calls[0][0];
        expect(req.prompt).toContain('Grace Hopper, 30 (paid)');
        expect(req.prompt).toContain(`at most ${IMPORT_LIMITS.max_rows} rows`);
        expect(req.prompt).not.toContain('Customer');
        expect(Object.keys(req.schema.properties.rows.items.properties)).toEqual(['a', 'b']);
    });

    it('never keeps text the paste does not have', async () => {
        const t = setup();
        t.set_answer({
            rows: [
                { a: 'Ada Lovelace', b: 12 },
                { a: 'Invented Name', b: null }
            ]
        });
        const res = await t.svc.preview(ACCT, 11, { text: TEXT });
        expect(res.proposed.rows).toEqual([{ a: 'Ada Lovelace', b: 12 }]);
        expect(t.count.rows).toBe(1);
    });

    it('takes at most the AI rows left, and says when more were in the text', async () => {
        const t = setup({ rows_left: 1 });
        const res = await t.svc.preview(ACCT, 11, { text: TEXT });
        expect(res.proposed.rows).toHaveLength(1);
        expect(res.capped).toBe(true);
        expect(res.answer).toMatch(/Only 1 of this month's AI rows/);
        expect(t.ai_client.json.mock.calls[0][0].prompt).toContain('at most 1 rows');
        expect(t.count.rows).toBe(1);
    });

    it('answers 429 without a model call or a question when no AI rows are left', async () => {
        const t = setup({ rows_left: 0 });
        expect(await status_of(t.svc.preview(ACCT, 11, { text: TEXT }))).toBe(429);
        expect(t.ai_client.json).not.toHaveBeenCalled();
        expect(t.count.questions).toBe(0);
    });

    it('hands the rows back when no question is left', async () => {
        const t = setup();
        t.limit.questions = 0;
        expect(await status_of(t.svc.preview(ACCT, 11, { text: TEXT }))).toBe(429);
        expect(t.ai_client.json).not.toHaveBeenCalled();
        expect(t.count.rows).toBe(0);
    });

    it('answers no rows when the text has none, using the question but no rows', async () => {
        const t = setup();
        t.set_answer({ rows: [] });
        const res = await t.svc.preview(ACCT, 11, { text: 'nothing here' });
        expect(res.proposed).toBeNull();
        expect(res.answer).toMatch(/couldn't find any rows/);
        expect(t.count).toEqual({ questions: 1, rows: 0 });
    });

    it('does not count a question the model never answered', async () => {
        const t = setup();
        t.set_answer(new Error('socket hang up'));
        expect(await status_of(t.svc.preview(ACCT, 11, { text: TEXT }))).toBe(502);
        expect(t.count).toEqual({ questions: 0, rows: 0 });
    });

    it('counts the question, and charges, when the answer was unusable', async () => {
        const t = setup();
        t.set_answer(
            new AiModelError('cut off', { input_tokens: 5, output_tokens: 5 } as any, 'm')
        );
        expect(await status_of(t.svc.preview(ACCT, 11, { text: TEXT }))).toBe(502);
        expect(t.count).toEqual({ questions: 1, rows: 0 });
        expect((t.ai_spend.charge.mock.calls[0] as any[])[2]).toHaveLength(1);
    });

    it("refuses another account's table, bad text, AI off and unverified, before any call", async () => {
        const t = setup();
        expect(await status_of(t.svc.preview(ACCT, 12, { text: TEXT }))).toBe(404);
        expect(await status_of(t.svc.preview(ACCT, 11, { text: ' ' }))).toBe(400);
        const long = 'x'.repeat(IMPORT_LIMITS.max_text_length + 1);
        expect(await status_of(t.svc.preview(ACCT, 11, { text: long }))).toBe(400);
        expect(t.ai_client.json).not.toHaveBeenCalled();
        expect(t.count).toEqual({ questions: 0, rows: 0 });

        const off = setup({ available: false });
        expect(await status_of(off.svc.preview(ACCT, 11, { text: TEXT }))).toBe(503);
        const unverified = setup({ verified: false });
        expect(await status_of(unverified.svc.preview(ACCT, 11, { text: TEXT }))).toBe(403);
        expect(unverified.ai_client.json).not.toHaveBeenCalled();
    });
});
