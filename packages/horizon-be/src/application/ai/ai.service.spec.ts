import {
    BadGatewayException,
    BadRequestException,
    ForbiddenException,
    HttpException,
    NotFoundException,
    ServiceUnavailableException
} from '@nestjs/common';
import { AI_OFF, AiService } from './ai.service';
import { AI_LIMITS, AI_MONTHLY_ROWS } from '@app/core/ai/ai';
import { AiModelError, StubModel } from '@app/core/ai/ai-model';

jest.mock('@app/logger', () => ({
    __esModule: true,
    default: { error: jest.fn(), info: jest.fn() }
}));
// Stand-ins below; the real ones pull in TypeORM and ESM-only packages
jest.mock('../file-directory/file-directory.service', () => ({}));
jest.mock('../account/account.service', () => ({}));
jest.mock('../table-template/table-template.service', () => ({}));

const ACCT = 7;
const OTHER = 8;
const NOW = Date.UTC(2026, 10, 25);

function setup() {
    const files = {
        11: { id: 11, account_id: ACCT, type: 'file', deleted: false },
        12: { id: 12, account_id: OTHER, type: 'file', deleted: false },
        13: { id: 13, account_id: ACCT, type: 'file', deleted: true }
    };
    const accounts = {
        [ACCT]: { id: ACCT, subscription_id: 'SUB_FREE' },
        [OTHER]: { id: OTHER, subscription_id: 'SUB_LIVE_PLUS' }
    };
    const usage = new Map<string, number>();
    const file_directory_svc = {
        assert_owned: jest.fn(async (acct, id) => {
            const f = files[Number(id)];
            if (!f) throw new NotFoundException();
            if (f.account_id !== acct) throw new ForbiddenException();
            return f;
        })
    };
    const account_svc = { get: jest.fn(async id => accounts[id] || null) };
    const table_template_svc = {
        create_from: jest.fn(async (_acct: number, _template: any, _body: any) => 99)
    };
    const tracking_manager = {
        check_account_lock: jest.fn(async () => undefined),
        check_table_lock: jest.fn(async () => undefined)
    };
    const web_file_manager = {
        get_columns: jest.fn(async () => [
            { field: 'a', headerName: 'Name', order: 1 },
            { field: 'b', headerName: 'Age', col_type: 'number', order: 2 },
            { field: 'c', headerName: 'Owner', col_type: 'link', order: 3 }
        ]),
        first_rows: jest.fn(async () => [{ _id: 'x', a: 'Ada', b: 36, c: ['id'] }])
    };
    const key = (acct, month) => `${acct}:${month}`;
    const usage_manager = {
        used: jest.fn(async (acct, month) => usage.get(key(acct, month)) || 0),
        reserve: jest.fn(async (acct, month, rows, allowance) => {
            const used = usage.get(key(acct, month)) || 0;
            if (used + rows > allowance) return false;
            usage.set(key(acct, month), used + rows);
            return true;
        }),
        release: jest.fn(async (acct, month, rows) => {
            if (rows <= 0) return;
            usage.set(key(acct, month), (usage.get(key(acct, month)) || 0) - rows);
        })
    };
    const svc = new AiService(
        file_directory_svc as any,
        account_svc as any,
        table_template_svc as any,
        tracking_manager as any,
        web_file_manager as any,
        usage_manager as any
    );
    svc.now = () => NOW;
    // Never the real model
    const stub = new StubModel();
    const model = { name: 'mock', json: jest.fn(req => stub.json(req)) };
    svc.model = model;
    const used = (acct = ACCT) => usage.get(key(acct, '2026-11')) || 0;
    return { svc, model, used, table_template_svc, tracking_manager, web_file_manager };
}

async function status_of(p: Promise<unknown>) {
    try {
        await p;
    } catch (ex) {
        return ex instanceof HttpException ? ex.getStatus() : ex;
    }
    return 200;
}

describe('AiService', () => {
    it('answers 503 on every route when there is no model, but reports its status', async () => {
        const { svc } = setup();
        svc.model = null;
        await expect(svc.generate_rows(ACCT, 11, { prompt: 'x' })).rejects.toThrow(
            ServiceUnavailableException
        );
        await expect(svc.preview_table(ACCT, { description: 'x' })).rejects.toThrow(AI_OFF);
        await expect(svc.create_table(ACCT, {})).rejects.toThrow(ServiceUnavailableException);
        const status = await svc.status(ACCT);
        expect(status.enabled).toBe(false);
        expect(status.model).toBeNull();
        expect(status.usage).toEqual({
            month: '2026-11',
            used: 0,
            allowance: AI_MONTHLY_ROWS.free
        });
        expect(status.limits.max_rows_per_request).toBe(AI_LIMITS.max_rows_per_request);
    });

    it('generates rows of the column types, not links, and counts them', async () => {
        const { svc, model, used } = setup();
        const res = await svc.generate_rows(ACCT, '11', { prompt: 'people', count: 3 });
        expect(res.rows).toEqual([
            { a: 'Name 1', b: 1 },
            { a: 'Name 2', b: 2 },
            { a: 'Name 3', b: 3 }
        ]);
        expect(res.columns.map(c => c.field)).toEqual(['a', 'b']);
        expect(used()).toBe(3);
        expect(res.usage.used).toBe(3);
        const req = model.json.mock.calls[0][0];
        expect(req.prompt).toContain('{"a":"Ada","b":36}');
        expect(req.prompt).toContain('people');
        expect(req.prompt).not.toContain('Owner');
    });

    it('splits a big request into several model calls', async () => {
        const { svc, model, used } = setup();
        const res = await svc.generate_rows(ACCT, 11, { prompt: 'x', count: 60 });
        expect(res.rows).toHaveLength(60);
        expect(model.json).toHaveBeenCalledTimes(Math.ceil(60 / AI_LIMITS.rows_per_call));
        expect(used()).toBe(60);
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
        // Free: 500 a month
        await svc.generate_rows(ACCT, 11, { prompt: 'x', count: 500 });
        expect(used()).toBe(AI_MONTHLY_ROWS.free);
        const calls = model.json.mock.calls.length;
        expect(await status_of(svc.generate_rows(ACCT, 11, { prompt: 'x', count: 1 }))).toBe(429);
        await expect(svc.preview_table(ACCT, { description: 'x' })).rejects.toThrow(/used up/);
        expect(model.json.mock.calls.length).toBe(calls);
        // The other account (Plus) is untouched
        expect((await svc.status(OTHER)).usage).toEqual({
            month: '2026-11',
            used: 0,
            allowance: AI_MONTHLY_ROWS.plus
        });
        // A new month starts again
        svc.now = () => Date.UTC(2026, 11, 1);
        expect((await svc.status(ACCT)).usage.used).toBe(0);
    });

    it('says how many rows are left when a request is too big for them', async () => {
        const { svc } = setup();
        await svc.generate_rows(ACCT, 11, { prompt: 'x', count: 450 });
        await expect(svc.generate_rows(ACCT, 11, { prompt: 'x', count: 100 })).rejects.toThrow(
            /Only 50 of this month's 500/
        );
    });

    it('charges every row asked of the model, even when the call fails', async () => {
        const { svc, model, used } = setup();
        model.json.mockResolvedValueOnce({ rows: [{ a: 'only one' }] });
        const res = await svc.generate_rows(ACCT, 11, { prompt: 'x', count: 5 });
        expect(res.rows).toHaveLength(1);
        expect(used()).toBe(5);

        model.json.mockRejectedValueOnce(new Error('overloaded'));
        expect(await status_of(svc.generate_rows(ACCT, 11, { prompt: 'x', count: 5 }))).toBe(502);
        expect(used()).toBe(10);
        model.json.mockRejectedValueOnce(new AiModelError('The AI declined this request'));
        await expect(svc.generate_rows(ACCT, 11, { prompt: 'x', count: 5 })).rejects.toThrow(
            /declined/
        );
        model.json.mockResolvedValueOnce({ rows: [] });
        await expect(svc.generate_rows(ACCT, 11, { prompt: 'x', count: 5 })).rejects.toThrow(
            BadGatewayException
        );
        expect(used()).toBe(20);
    });

    it('keeps the rows of the calls that worked when one fails', async () => {
        const { svc, model, used } = setup();
        model.json.mockImplementationOnce(async () => {
            throw new Error('cut off');
        });
        const res = await svc.generate_rows(ACCT, 11, { prompt: 'x', count: 60 });
        expect(res.rows).toHaveLength(60 - AI_LIMITS.rows_per_call);
        expect(used()).toBe(60);
    });

    it('hands back rows of calls never started after a failure', async () => {
        const { svc, model, used } = setup();
        const parallel = AI_LIMITS.parallel_calls;
        (AI_LIMITS as any).parallel_calls = 1;
        try {
            model.json.mockRejectedValueOnce(new Error('cut off'));
            expect(await status_of(svc.generate_rows(ACCT, 11, { prompt: 'x', count: 60 }))).toBe(
                502
            );
            expect(model.json).toHaveBeenCalledTimes(1);
            expect(used()).toBe(AI_LIMITS.rows_per_call);
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

    it('charges a design one row, failed or not, and its rows as asked', async () => {
        const { svc, model, used } = setup();
        await svc.preview_table(ACCT, { description: 'x', row_count: 0 });
        expect(model.json).toHaveBeenCalledTimes(1);
        expect(used()).toBe(1);
        model.json.mockResolvedValueOnce({ table_name: 'x', columns: [] });
        expect(await status_of(svc.preview_table(ACCT, { description: 'x' }))).toBe(400);
        expect(used()).toBe(2);
        model.json.mockRejectedValueOnce(new Error('down'));
        expect(await status_of(svc.preview_table(ACCT, { description: 'x', row_count: 5 }))).toBe(
            502
        );
        expect(used()).toBe(3);
        // The design works but its rows fail: the rows asked for are charged
        model.json.mockImplementationOnce(req => new StubModel().json(req));
        model.json.mockRejectedValueOnce(new Error('cut off'));
        expect(await status_of(svc.preview_table(ACCT, { description: 'x', row_count: 5 }))).toBe(
            502
        );
        expect(used()).toBe(8);
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
