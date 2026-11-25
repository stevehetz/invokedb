import { HttpException, HttpStatus } from '@nestjs/common';
import { ObjectId } from 'mongodb';
import { TrackingManager } from './tracking.manager';

const FILE_ID = 7;
const account = { id: 3 };

// An in-memory column collection with just what TrackingManager's column checks use
function column_collection(docs: any[]) {
    const matches = (doc, query) => {
        if (query.file_directory_id !== undefined && doc.file_directory_id !== FILE_ID) {
            return false;
        }
        if (query._id && !query._id.$in.some(id => id.equals(doc._id))) return false;
        if (query.deleted === true) return doc.deleted === true;
        if (query.deleted && query.deleted.$in) return query.deleted.$in.includes(doc.deleted);
        return true;
    };
    return {
        async countDocuments(query) {
            return docs.filter(doc => matches(doc, query)).length;
        }
    };
}

function make_manager(active: number, placeholders: number) {
    const docs = [];
    for (let i = 0; i < active; i++) {
        docs.push({ _id: new ObjectId(), file_directory_id: FILE_ID, deleted: false });
    }
    for (let i = 0; i < placeholders; i++) {
        docs.push({ _id: new ObjectId(), file_directory_id: FILE_ID, deleted: true });
    }
    const collections = { get_dg_collection: async () => column_collection(docs) };
    const manager = new TrackingManager(collections as any, null, null, null);
    return {
        manager,
        active: docs.filter(d => !d.deleted).map(d => String(d._id)),
        placeholders: docs.filter(d => d.deleted).map(d => String(d._id))
    };
}

describe('TrackingManager.add_columns', () => {
    it('rejects with 403 when turning on columns would pass 52', async () => {
        const { manager, placeholders } = make_manager(51, 2);
        const columns = placeholders.map(_id => ({ _id, headerName: 'x', deleted: false }));
        const res = manager.add_columns(account, { file_id: FILE_ID, columns });
        await expect(res).rejects.toBeInstanceOf(HttpException);
        await expect(res).rejects.toMatchObject({
            status: HttpStatus.FORBIDDEN,
            message: 'Column count limit exceeded for current subscription'
        });
    });

    it('allows turning on columns up to 52', async () => {
        const { manager, placeholders } = make_manager(50, 2);
        const columns = placeholders.map(_id => ({ _id, headerName: 'x', deleted: false }));
        await expect(
            manager.add_columns(account, { file_id: FILE_ID, columns })
        ).resolves.toBeUndefined();
    });

    it('counts a column sent twice once', async () => {
        const { manager, placeholders } = make_manager(51, 1);
        const columns = [placeholders[0], placeholders[0]].map(_id => ({ _id, deleted: false }));
        await expect(
            manager.add_columns(account, { file_id: FILE_ID, columns })
        ).resolves.toBeUndefined();
    });

    it('allows editing every column of a full table (order, width, names)', async () => {
        const { manager, active } = make_manager(52, 3);
        const columns = active.map((_id, i) => ({ _id, order: i, width: 120, deleted: false }));
        await expect(
            manager.add_columns(account, { file_id: FILE_ID, columns })
        ).resolves.toBeUndefined();
    });

    it("doesn't count updates that leave a deleted column deleted", async () => {
        const { manager, placeholders } = make_manager(52, 2);
        const columns = [
            { _id: placeholders[0], deleted: true },
            { _id: placeholders[1], width: 90 }
        ];
        await expect(
            manager.add_columns(account, { file_id: FILE_ID, columns })
        ).resolves.toBeUndefined();
    });
});
