import {
    BadRequestException,
    ForbiddenException,
    HttpException,
    NotFoundException,
    ServiceUnavailableException
} from '@nestjs/common';
import { ObjectId } from 'mongodb';
import { CleanupService } from './cleanup.service';
import { EditService } from './edit.service';
import { AiModelError } from '@app/core/ai/ai-client';

// Stand-ins; the real ones pull in TypeORM, ESM-only packages and the Anthropic SDK. The model
// is never called: its answers are scripted.
jest.mock('../file-directory/file-directory.service', () => ({}));
jest.mock('../account/account.service', () => ({}));
jest.mock('../web-file/web-file.service', () => ({}));
jest.mock('./ask.service', () => ({}));
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

function setup(opts: { verified?: boolean; available?: boolean } = {}) {
    const rows = new Map<string, any>();
    const add = (doc: any) => {
        const _id = new ObjectId();
        rows.set(String(_id), { _id, ...doc });
        return String(_id);
    };
    const files = {
        11: { id: 11, account_id: ACCT, name: 'people', type: 'file', deleted: false },
        12: { id: 12, account_id: OTHER, name: 'theirs', type: 'file', deleted: false }
    };
    const account_svc = {
        get: jest.fn(async id => ({ id, email_verified: opts.verified !== false }))
    };
    const tracking_manager = {
        check_account_lock: jest.fn(async () => undefined),
        check_table_lock: jest.fn(async () => undefined)
    };
    const web_file_manager = {
        get_columns: jest.fn(async () => [
            { field: 'a', headerName: 'Name' },
            { field: 'b', headerName: 'State' },
            { field: 'c', headerName: 'Age', col_type: 'number' }
        ]),
        query_rows: jest.fn(async (_acct, _file, query) => ({
            docs: [...rows.values()].slice(0, query.limit + 1),
            explain: null
        })),
        count_rows: jest.fn(async () => rows.size),
        rows_by_ids: jest.fn(async (_acct, _file, ids: string[]) => {
            const out = new Map();
            ids.forEach(id => rows.has(id) && out.set(id, rows.get(id)));
            return out;
        }),
        format_date_field: jest.fn(v => v)
    };
    const web_file_svc = {
        batch_delete: jest.fn(async (_account, _file, _type, ids: string[]) => {
            ids.forEach(id => rows.delete(id));
            return ids.length;
        }),
        batch_create_internal: jest.fn(async (_account, _file, _type, data: any[]) => {
            data.forEach(d => add(d));
        })
    };
    const ai_client = {
        available: jest.fn(() => opts.available !== false),
        json: jest.fn(async (_req: any): Promise<any> => ({
            data: { spellings: [], near_duplicates: [] },
            usage: { input_tokens: 100, output_tokens: 10 },
            model: 'claude-haiku-5-5'
        }))
    };
    const ai_spend = { charge: jest.fn(async () => 0) };
    let questions = 0;
    const ask_service = {
        owned_table: jest.fn(async (acct, id) => {
            const f = files[Number(id)];
            if (!f || f.account_id !== acct) throw new NotFoundException();
            return f;
        }),
        reserve_question: jest.fn(async () => {
            questions++;
            return '2026-11';
        }),
        usage: jest.fn(async () => ({ used: questions, limit: 20 }))
    };
    const edit_service = new EditService(
        {} as any,
        account_svc as any,
        web_file_manager as any,
        web_file_svc as any
    );
    const svc = new CleanupService(
        account_svc as any,
        tracking_manager as any,
        web_file_manager as any,
        web_file_svc as any,
        ai_client as any,
        ai_spend as any,
        ask_service as any,
        edit_service
    );
    return {
        svc,
        rows,
        add,
        ai_client,
        ai_spend,
        ask_service,
        web_file_svc,
        web_file_manager,
        tracking_manager
    };
}

describe('CleanupService.scan', () => {
    it('answers problems from code and the model, using one question', async () => {
        const t = setup();
        const ids = [
            t.add({ a: 'Ada ', b: 'CA', c: 36 }),
            t.add({ a: 'Bob', b: 'California', c: 41 }),
            t.add({ a: 'Bob', b: 'California', c: 41 }),
            t.add({ a: 'Cy', b: 'CA', c: 20 }),
            t.add({ a: 'Di', b: 'CA', c: 22 })
        ];
        t.ai_client.json.mockImplementationOnce(async () => ({
            data: {
                spellings: [{ column: 'State', canonical: 'CA', variants: ['California'] }],
                near_duplicates: []
            },
            usage: { input_tokens: 100, output_tokens: 10 },
            model: 'claude-haiku-5-5'
        }));
        const res = await t.svc.scan(ACCT, '11');
        expect(res.ai).toBe('checked');
        expect(res.scanned).toBe(5);
        expect(res.capped).toBe(false);
        expect(res.problems.map(p => p.kind)).toEqual(['whitespace', 'duplicate', 'spelling']);
        expect(res.problems[1].delete.rows.map(r => r._id)).toEqual([ids[2]]);
        // The duplicate isn't sent for near-duplicates; State is sent for spellings
        const prompt = t.ai_client.json.mock.calls[0][0].prompt;
        expect(prompt).toContain('"column":"State"');
        expect(t.ask_service.reserve_question).toHaveBeenCalledTimes(1);
        expect(t.ai_spend.charge).toHaveBeenCalledWith(ACCT, '2026-11', [
            { model: 'claude-haiku-5-5', usage: { input_tokens: 100, output_tokens: 10 } }
        ]);
        expect(res.usage.used).toBe(1);
        // Nothing was written
        expect(t.rows.size).toBe(5);
        expect(t.web_file_svc.batch_delete).not.toHaveBeenCalled();
    });

    it("doesn't call the model when there's nothing for it", async () => {
        const t = setup();
        t.add({ a: 'Ada', b: 'CA', c: 1 });
        const res = await t.svc.scan(ACCT, '11');
        expect(res.ai).toBe('none');
        expect(t.ai_client.json).not.toHaveBeenCalled();
        expect(t.ask_service.reserve_question).toHaveBeenCalledTimes(1);
    });

    it('still answers the checks in code when the model fails, and charges what it used', async () => {
        const t = setup();
        ['Ada ', 'Bob', 'Cy', 'Di'].forEach(a => t.add({ a, b: 'CA' }));
        t.ai_client.json.mockImplementationOnce(async () => {
            throw new AiModelError('cut off', { input_tokens: 5, output_tokens: 5 } as any, 'm');
        });
        const res = await t.svc.scan(ACCT, '11');
        expect(res.ai).toBe('failed');
        expect(res.problems.map(p => p.kind)).toEqual(['whitespace']);
        expect(res.answer).toContain("didn't answer");
        expect(t.ai_spend.charge).toHaveBeenCalledWith(ACCT, '2026-11', [
            { model: 'm', usage: { input_tokens: 5, output_tokens: 5 } }
        ]);
    });

    it('refuses before using a question', async () => {
        const off = setup({ available: false });
        await expect(off.svc.scan(ACCT, '11')).rejects.toBeInstanceOf(ServiceUnavailableException);
        const unverified = setup({ verified: false });
        await expect(unverified.svc.scan(ACCT, '11')).rejects.toBeInstanceOf(ForbiddenException);
        const t = setup();
        await expect(t.svc.scan(ACCT, '12')).rejects.toBeInstanceOf(NotFoundException);
        expect(t.ask_service.reserve_question).not.toHaveBeenCalled();
        expect(off.ask_service.reserve_question).not.toHaveBeenCalled();
        expect(unverified.ask_service.reserve_question).not.toHaveBeenCalled();
    });

    it('passes on a 429 from the allowance', async () => {
        const t = setup();
        t.ask_service.reserve_question.mockImplementationOnce(async () => {
            throw new HttpException('used up', 429);
        });
        await expect(t.svc.scan(ACCT, '11')).rejects.toMatchObject({ status: 429 });
        expect(t.ai_client.json).not.toHaveBeenCalled();
    });
});

describe('CleanupService.delete_rows and restore_rows', () => {
    it('deletes only rows that still hold what the scan showed, and puts them back', async () => {
        const t = setup();
        t.add({ a: 'Ada', b: 'CA', c: 1 });
        const dup = t.add({ a: 'Ada', b: 'CA', c: 1 });
        const changed = t.add({ a: 'Ada', b: 'CA', c: 1 });
        t.rows.get(changed).c = 2;
        const before = { a: 'Ada', b: 'CA', c: 1 };
        const res = await t.svc.delete_rows(ACCT, '11', {
            rows: [
                { _id: dup, before },
                { _id: changed, before }
            ]
        });
        expect(res).toEqual({ deleted: [dup], skipped: [changed] });
        expect(t.rows.has(dup)).toBe(false);
        expect(t.rows.has(changed)).toBe(true);
        expect(t.tracking_manager.check_table_lock).toHaveBeenCalledWith(11);

        const restored = await t.svc.restore_rows(ACCT, '11', { rows: [before] });
        expect(restored).toEqual({ restored: 1 });
        expect(t.rows.size).toBe(3);
        const [account, file_id, type, data] = t.web_file_svc.batch_create_internal.mock.calls[0];
        expect([account.id, file_id, type, data]).toEqual([ACCT, 11, 'data_grid_row', [before]]);
    });

    it('deletes and restores duplicates holding values not of their column type', async () => {
        const t = setup();
        // As /api/v1 can store them: true and a number in text columns, text in a number one
        t.add({ a: true, b: 12345, c: 'n/a' });
        t.add({ a: true, b: 12345, c: 'n/a' });
        const scan = await t.svc.scan(ACCT, '11');
        const dupes = scan.problems.find(p => p.kind === 'duplicate').delete.rows;
        expect(dupes).toHaveLength(1);
        const { _id, before } = dupes[0];
        expect(before).toEqual({ a: true, b: 12345, c: 'n/a' });
        // Through JSON, as the app sends it back
        const body = JSON.parse(JSON.stringify({ rows: [{ _id, before }] }));
        expect(await t.svc.delete_rows(ACCT, '11', body)).toEqual({ deleted: [_id], skipped: [] });
        // Exact values: '12345' isn't what was scanned
        const other = t.add({ a: true, b: '12345', c: 'n/a' });
        expect(await t.svc.delete_rows(ACCT, '11', { rows: [{ _id: other, before }] })).toEqual({
            deleted: [],
            skipped: [other]
        });
        expect(await t.svc.restore_rows(ACCT, '11', { rows: [before] })).toEqual({ restored: 1 });
    });

    it('refuses to delete rows of a table with link columns', async () => {
        const t = setup();
        t.web_file_manager.get_columns.mockResolvedValue([
            { field: 'a', headerName: 'Name' },
            { field: 'l', headerName: 'Orders', col_type: 'link' }
        ]);
        t.add({ a: 'Ada', l: [] });
        const dup = t.add({ a: 'Ada', l: [] });
        await expect(
            t.svc.delete_rows(ACCT, '11', { rows: [{ _id: dup, before: { a: 'Ada' } }] })
        ).rejects.toBeInstanceOf(BadRequestException);
        expect(t.web_file_svc.batch_delete).not.toHaveBeenCalled();

        const res = await t.svc.scan(ACCT, '11');
        expect(res.problems.find(p => p.kind === 'duplicate')).toBeUndefined();
        expect(res.answer).toContain("Duplicate rows weren't checked");
    });

    it("refuses another account's table and bad bodies", async () => {
        const t = setup();
        const id = t.add({ a: 'Ada' });
        await expect(
            t.svc.delete_rows(ACCT, '12', { rows: [{ _id: id, before: { a: 'Ada' } }] })
        ).rejects.toBeInstanceOf(NotFoundException);
        await expect(t.svc.restore_rows(ACCT, '12', { rows: [{ a: 'x' }] })).rejects.toBeInstanceOf(
            NotFoundException
        );
        await expect(
            t.svc.delete_rows(ACCT, '11', { rows: [{ _id: id, before: { zz: 1 } }] })
        ).rejects.toBeInstanceOf(BadRequestException);
        await expect(t.svc.restore_rows(ACCT, '11', { rows: [] })).rejects.toBeInstanceOf(
            BadRequestException
        );
        expect(t.web_file_svc.batch_delete).not.toHaveBeenCalled();
        expect(t.web_file_svc.batch_create_internal).not.toHaveBeenCalled();
        expect(t.rows.size).toBe(1);
    });
});
