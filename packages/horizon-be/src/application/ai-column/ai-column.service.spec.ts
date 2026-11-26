import { BadRequestException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ObjectId } from 'mongodb';
import { AiColumnService } from './ai-column.service';
import { AiModelError } from '@app/core/ai/ai-client';
import { ROW_STATE_KEY, settings_hash } from '@app/core/ai-column/ai-column';

// Stand-ins; the real ones pull in TypeORM, ESM-only packages and the Anthropic SDK. The model
// is never called: its answers are scripted.
jest.mock('@app/logger', () => ({
    __esModule: true,
    default: { error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() }
}));
jest.mock('../account/account.service', () => ({}));
jest.mock('../file-directory/file-directory.service', () => ({}));
jest.mock('../web-file/web-file-prc-notify.service', () => ({}));
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
const FILE = 11;

// Just enough of a Mongo collection for the service: find, bulkWrite and updateMany with
// equality filters, `$in` on _id and dotted `$set` paths
function rows_collection(docs: any[]) {
    const matches = (doc, filter) =>
        Object.keys(filter).every(k => {
            const want = filter[k];
            if (want && typeof want === 'object' && Array.isArray(want.$in)) {
                return want.$in.some(v => String(v) === String(doc[k]));
            }
            const have = doc[k] === undefined ? null : doc[k];
            return have instanceof Date && want instanceof Date
                ? have.getTime() === want.getTime()
                : have === want;
        });
    const set = (doc, update) =>
        Object.entries(update.$set).forEach(([path, value]) => {
            const parts = path.split('.');
            let target = doc;
            parts.slice(0, -1).forEach(p => (target = target[p] = target[p] || {}));
            target[parts[parts.length - 1]] = value;
        });
    return {
        docs,
        find: (filter = {}) => ({
            async *[Symbol.asyncIterator]() {
                for (const d of docs.filter(d => matches(d, filter))) yield { ...d };
            }
        }),
        bulkWrite: jest.fn(async (ops: any[]) => {
            ops.forEach(op => {
                const doc = docs.find(d => matches(d, op.updateOne.filter));
                if (doc) set(doc, op.updateOne.update);
            });
        }),
        updateMany: jest.fn(async (filter, update) => {
            docs.filter(d => matches(d, filter)).forEach(d => set(d, update));
        })
    };
}

function setup(
    opts: { rows_left?: number; available?: boolean; rows?: any[]; paused?: boolean } = {}
) {
    const files = {
        [FILE]: { id: FILE, account_id: ACCT, type: 'file', deleted: false },
        12: { id: 12, account_id: OTHER, type: 'file', deleted: false }
    };
    const file_directory_svc = {
        get_by_id: jest.fn(async id => files[id]),
        assert_owned: jest.fn(async (acct, id) => {
            const f = files[Number(id)];
            if (!f) throw new NotFoundException();
            if (f.account_id !== acct) throw new UnauthorizedException();
            return f;
        })
    };
    const account_svc = { get: jest.fn(async id => ({ id, email_verified: true })) };
    const notify = { ws_pr_send_to_fe: jest.fn() };
    const tracking = {
        check_account_lock: jest.fn(async () => undefined),
        check_table_lock: jest.fn(async () => undefined)
    };
    const columns = [
        { field: 'a', headerName: 'Feedback' },
        { field: 'b', headerName: 'Sentiment' },
        { field: 'c', headerName: 'Other' }
    ];
    const web_file_manager = { get_columns: jest.fn(async () => columns) };
    const rows = rows_collection(
        opts.rows ||
            Array.from({ length: 30 }, (_, i) => ({
                _id: new ObjectId(),
                a: i === 29 ? null : `feedback ${i}`,
                c: 'x'
            }))
    );
    const collections = { get_dg_row: jest.fn(async () => rows) };
    const ai_client = {
        available: jest.fn(() => opts.available !== false),
        json: jest.fn(async (req: any): Promise<any> => {
            const n = (req.prompt.match(/^\d+: /gm) || []).length;
            const values = Array.from({ length: n }, (_, i) => ({ row: i + 1, value: 'positive' }));
            return { data: { values }, usage: { input_tokens: 10, output_tokens: 5 }, model: 'm' };
        })
    };
    // The account is on Free (50 AI rows a month); `rows_left` of them are left
    const usage = { rows: 50 - (opts.rows_left ?? 50), cost_micros: 0 };
    const ai_usage = {
        get: jest.fn(async () => ({ ...usage })),
        reserve_rows: jest.fn(async (_a, _m, n: number, allowance: number) => {
            if (usage.rows + n > allowance) return false;
            usage.rows += n;
            return true;
        }),
        release_rows: jest.fn(async (_a, _m, n: number) => void (usage.rows -= n))
    };
    const ai_spend = {
        paused: jest.fn(async () => !!opts.paused),
        charge: jest.fn(async () => 1)
    };
    let stored: any = null;
    const manager = {
        list: jest.fn(async () => (stored ? [stored] : [])),
        get: jest.fn(async (_a, _f, field) => (stored && stored.field === field ? stored : null)),
        save: jest.fn(async (account_id, file_id, settings) => {
            stored = { account_id, file_id, ...settings, auto: false, state: 'idle' };
            return stored;
        }),
        fill: jest.fn(async (_a, _f, _field, hash) => {
            Object.assign(stored, { auto: true, filled_hash: hash, state: 'filling' });
        }),
        remove: jest.fn(async () => true),
        remove_table: jest.fn(async () => undefined),
        release: jest.fn(async () => undefined)
    };
    const svc = new AiColumnService(
        file_directory_svc as any,
        account_svc as any,
        notify as any,
        tracking as any,
        web_file_manager as any,
        collections as any,
        ai_client as any,
        ai_usage as any,
        ai_spend as any,
        manager as any
    );
    const save = () =>
        svc.save(ACCT, { table: FILE, field: 'b', prompt: 'Classify', inputs: ['a'] });
    const claimed = () => ({ ...stored, full: true, dirty_ids: [] });
    return { svc, rows, ai_client, ai_usage, ai_spend, manager, notify, usage, save, claimed };
}

describe('AiColumnService routes', () => {
    it("saves settings for the caller's own table only", async () => {
        const t = setup();
        const res = await t.save();
        expect(res.column).toMatchObject({ field: 'b', inputs: ['a'], auto: false });
        await expect(
            t.svc.save(ACCT, { table: 12, field: 'b', prompt: 'x', inputs: ['a'] })
        ).rejects.toBeInstanceOf(UnauthorizedException);
        await expect(t.svc.list(OTHER, FILE)).rejects.toBeInstanceOf(UnauthorizedException);
        await expect(
            t.svc.save(ACCT, { table: FILE, field: 'b', prompt: 'x', inputs: ['b'] })
        ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('estimates the AI rows a fill uses: rows with something to read', async () => {
        const t = setup({ rows_left: 40 });
        await t.save();
        expect(await t.svc.estimate(ACCT, FILE, 'b')).toEqual({
            rows: 29,
            empty: 1,
            left: 40,
            limit: 50,
            available: true
        });
        await expect(t.svc.estimate(ACCT, FILE, 'c')).rejects.toBeInstanceOf(NotFoundException);
        await expect(t.svc.fill(OTHER, FILE, 'b')).rejects.toBeInstanceOf(UnauthorizedException);
    });
});

describe('AiColumnService processor', () => {
    it('fills every row, one AI row per computed cell, in batches', async () => {
        const t = setup();
        await t.save();
        await t.svc.fill(ACCT, FILE, 'b');
        await t.svc.run(t.claimed());
        // 29 rows with feedback: two calls (25 + 4); the empty row is null without a call
        expect(t.ai_client.json).toHaveBeenCalledTimes(2);
        expect(t.usage.rows).toBe(29);
        expect(t.ai_spend.charge).toHaveBeenCalledTimes(2);
        expect(t.rows.docs.filter(d => d.b === 'positive')).toHaveLength(29);
        expect(t.rows.docs[29].b).toBe(null);
        expect(t.rows.docs.every(d => d[ROW_STATE_KEY].b.h)).toBe(true);
        expect(t.manager.release).toHaveBeenCalledWith(
            expect.anything(),
            { state: 'done', stopped_reason: null },
            29,
            false
        );
        expect(t.notify.ws_pr_send_to_fe).toHaveBeenCalledWith(
            expect.objectContaining({ event: 'AI_COLUMN_FILLED', file_id: FILE })
        );

        // Nothing changed: nothing is computed again
        t.ai_client.json.mockClear();
        await t.svc.run(t.claimed());
        expect(t.ai_client.json).not.toHaveBeenCalled();
        expect(t.usage.rows).toBe(29);

        // One row's input changed (and another's unrelated column): only it is computed
        t.rows.docs[3].a = 'changed';
        t.rows.docs[4].c = 'unrelated';
        const dirty_ids = [String(t.rows.docs[3]._id), String(t.rows.docs[4]._id)];
        await t.svc.run({ ...t.claimed(), full: false, dirty_ids });
        expect(t.ai_client.json).toHaveBeenCalledTimes(1);
        expect(t.ai_client.json.mock.calls[0][0].prompt).toContain('1: {"Feedback":"changed"}');
        expect(t.usage.rows).toBe(30);
    });

    it('stops when the allowance runs out: the rest stay empty with a note, nothing fails', async () => {
        const t = setup({ rows_left: 10 });
        await t.save();
        await t.svc.fill(ACCT, FILE, 'b');
        await t.svc.run(t.claimed());
        expect(t.usage.rows).toBe(50);
        const filled = t.rows.docs.filter(d => d.b === 'positive');
        expect(filled).toHaveLength(10);
        const noted = t.rows.docs.filter(d => d[ROW_STATE_KEY]?.b?.s === 'limit');
        expect(noted).toHaveLength(19);
        expect(noted.every(d => d.b === undefined)).toBe(true);
        expect(t.manager.release).toHaveBeenLastCalledWith(
            expect.anything(),
            { state: 'stopped', stopped_reason: 'limit' },
            10,
            false
        );
    });

    it('fills nothing while AI is paused or off, with a note', async () => {
        for (const [opts, reason] of [
            [{ paused: true }, 'paused'],
            [{ available: false }, 'off']
        ] as const) {
            const t = setup(opts);
            await t.save();
            await t.svc.fill(ACCT, FILE, 'b');
            await t.svc.run(t.claimed());
            expect(t.ai_client.json).not.toHaveBeenCalled();
            expect(t.usage.rows).toBe(0);
            expect(t.rows.docs.filter(d => d[ROW_STATE_KEY]?.b?.s === reason)).toHaveLength(29);
        }
    });

    it('hands back the rows of a call that got no answer, and counts a paid bad one', async () => {
        const t = setup();
        await t.save();
        await t.svc.fill(ACCT, FILE, 'b');
        t.ai_client.json.mockImplementation(async () => {
            throw new Error('network');
        });
        await t.svc.run(t.claimed());
        expect(t.usage.rows).toBe(0);
        expect(t.rows.docs.filter(d => d[ROW_STATE_KEY]?.b?.s === 'error')).toHaveLength(29);

        t.ai_client.json.mockImplementation(async () => {
            throw new AiModelError('declined', { input_tokens: 5, output_tokens: 1 } as any, 'm');
        });
        await t.svc.run(t.claimed());
        expect(t.usage.rows).toBeGreaterThan(0);
    });

    it("doesn't fill under settings the owner didn't confirm", async () => {
        const t = setup();
        await t.save();
        await t.svc.fill(ACCT, FILE, 'b');
        await t.svc.run({ ...t.claimed(), prompt: 'Something else' });
        expect(t.ai_client.json).not.toHaveBeenCalled();
        expect(t.manager.release).toHaveBeenCalledWith(
            expect.anything(),
            { auto: false, state: 'idle', stopped_reason: null },
            0,
            false
        );
        expect(settings_hash({ field: 'b', prompt: 'Classify', inputs: ['a'] }, 'string')).toBe(
            t.manager.fill.mock.calls[0][3]
        );
    });

    it("drops a deleted table's AI columns", async () => {
        const t = setup();
        await t.save();
        await t.svc.run({ ...t.claimed(), file_id: 99 });
        expect(t.manager.remove_table).toHaveBeenCalledWith(ACCT, 99);
        expect(t.ai_client.json).not.toHaveBeenCalled();
    });
});
