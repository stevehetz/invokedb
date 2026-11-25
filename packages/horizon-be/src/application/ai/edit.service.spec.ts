import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ObjectId } from 'mongodb';
import { EditService } from './edit.service';

// Stand-ins; the real ones pull in TypeORM and ESM-only packages
jest.mock('../file-directory/file-directory.service', () => ({}));
jest.mock('../account/account.service', () => ({}));
jest.mock('../web-file/web-file.service', () => ({}));

const ACCT = 7;
const OTHER = 8;

function setup() {
    const rows = new Map<string, any>();
    const add = (doc: any) => {
        const _id = new ObjectId();
        rows.set(String(_id), { _id, ...doc });
        return String(_id);
    };
    const files = {
        11: { id: 11, account_id: ACCT, name: 'People', type: 'file', deleted: false },
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
    const account_svc = { get: jest.fn(async id => ({ id })) };
    const web_file_manager = {
        get_columns: jest.fn(async () => [
            { field: 'a', headerName: 'Name' },
            { field: 'b', headerName: 'Age', col_type: 'number' },
            { field: 'c', headerName: 'Boss', col_type: 'link', link_table_id: 11 }
        ]),
        rows_by_ids: jest.fn(async (_acct, _file, ids: string[]) => {
            const out = new Map();
            ids.forEach(id => rows.has(id) && out.set(id, rows.get(id)));
            return out;
        }),
        format_date_field: jest.fn(v => v)
    };
    // The ordinary row update (locks, webhooks), here a write to the map
    const web_file_svc = {
        batch_update_internal: jest.fn(async (_account, _file, _type, data: any[]) => {
            data.forEach(({ _id, ...cells }) => Object.assign(rows.get(_id), cells));
            return data.length;
        })
    };
    const svc = new EditService(
        file_directory_svc as any,
        account_svc as any,
        web_file_manager as any,
        web_file_svc as any
    );
    return { svc, rows, add, web_file_svc };
}

describe('EditService.apply', () => {
    it('writes the rows that still hold the previewed values, and undoes them', async () => {
        const { svc, rows, add, web_file_svc } = setup();
        const ada = add({ a: 'ada', b: 36 });
        const bob = add({ a: 'bob', b: 41 });
        const edit = [
            { _id: ada, before: { a: 'ada' }, after: { a: 'Ada' } },
            { _id: bob, before: { a: 'bob' }, after: { a: 'Bob' } }
        ];
        // bob changed after the preview
        rows.get(bob).a = 'Robert';
        const res = await svc.apply(ACCT, '11', { rows: edit });
        expect(res).toEqual({ updated: [ada], skipped: [bob] });
        expect(rows.get(ada).a).toBe('Ada');
        expect(rows.get(bob).a).toBe('Robert');
        const [account, file_id, type, data] = web_file_svc.batch_update_internal.mock.calls[0];
        expect(account.id).toBe(ACCT);
        expect(file_id).toBe(11);
        expect(type).toBe('data_grid_row');
        expect(data).toEqual([{ _id: ada, a: 'Ada' }]);

        // Undo: the same edit backwards, for the rows it changed
        const undo = await svc.apply(ACCT, 11, {
            rows: [{ _id: ada, before: { a: 'Ada' }, after: { a: 'ada' } }]
        });
        expect(undo).toEqual({ updated: [ada], skipped: [] });
        expect(rows.get(ada).a).toBe('ada');
    });

    it('skips deleted rows and writes nothing when no row qualifies', async () => {
        const { svc, web_file_svc } = setup();
        const gone = new ObjectId().toHexString();
        const res = await svc.apply(ACCT, 11, {
            rows: [{ _id: gone, before: { a: 'x' }, after: { a: 'y' } }]
        });
        expect(res).toEqual({ updated: [], skipped: [gone] });
        expect(web_file_svc.batch_update_internal).not.toHaveBeenCalled();
    });

    it("refuses link columns, bad values and other accounts' tables", async () => {
        const { svc, add, web_file_svc } = setup();
        const id = add({ a: 'ada', b: 36 });
        const bad = [
            { rows: [{ _id: id, before: { c: null }, after: { c: [id] } }] },
            { rows: [{ _id: id, before: { b: 36 }, after: { b: 'old' } }] },
            { rows: [] },
            {}
        ];
        for (const body of bad) {
            await expect(svc.apply(ACCT, 11, body)).rejects.toThrow(BadRequestException);
        }
        const ok = { rows: [{ _id: id, before: { a: 'ada' }, after: { a: 'Ada' } }] };
        await expect(svc.apply(OTHER, 11, ok)).rejects.toThrow(ForbiddenException);
        await expect(svc.apply(ACCT, 12, ok)).rejects.toThrow(ForbiddenException);
        await expect(svc.apply(ACCT, 13, ok)).rejects.toThrow(NotFoundException);
        await expect(svc.apply(ACCT, '', ok)).rejects.toThrow(BadRequestException);
        expect(web_file_svc.batch_update_internal).not.toHaveBeenCalled();
    });
});
