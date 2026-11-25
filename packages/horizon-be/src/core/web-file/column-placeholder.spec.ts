import { ObjectId } from 'mongodb';
import { is_unused_placeholder } from './column-placeholder';
import { WebFileManager } from './web-file.manager';

// A column collection in memory: `find({}).toArray()` in insertion order, and `insertOne`
function fake_columns(docs: any[]) {
    return {
        docs,
        find: () => ({ toArray: async () => docs.map(d => ({ ...d })) }),
        insertOne: async (doc: any) => {
            const _id = new ObjectId();
            docs.push({ ...doc, _id });
            return { insertedId: _id };
        }
    };
}

// get_new_column only uses `_collections` and `get_next_column_key`, so skip the constructor
function manager_with(coll: ReturnType<typeof fake_columns>) {
    const mgr = Object.create(WebFileManager.prototype);
    mgr._collections = { get_dg_col: async () => coll };
    return mgr as WebFileManager;
}

describe('is_unused_placeholder', () => {
    it.each([
        [{ deleted: true, headerName: '' }, true],
        [{ deleted: true, headerName: '  ' }, true],
        [{ deleted: true }, true],
        [{ deleted: true, headerName: 'Gone' }, false],
        [{ deleted: false, headerName: '' }, false],
        [{ headerName: 'Name' }, false],
        [null, false]
    ])('%p -> %p', (col, expected) => expect(is_unused_placeholder(col)).toBe(expected));
});

describe('WebFileManager.get_new_column', () => {
    it('inserts a placeholder after the last column', async () => {
        const coll = fake_columns([
            { _id: new ObjectId(), field: 'a', headerName: 'Name', col_index: 1 }
        ]);
        const col = await manager_with(coll).get_new_column(1, '7');
        expect(col).toMatchObject({
            file_directory_id: 7,
            field: 'b',
            col_index: 2,
            order: 2,
            headerName: '',
            deleted: true
        });
        expect(coll.docs).toHaveLength(2);
    });

    it('hands out the same unused placeholder on repeated calls', async () => {
        const coll = fake_columns([
            { _id: new ObjectId(), field: 'a', headerName: 'Name', col_index: 1 }
        ]);
        const mgr = manager_with(coll);
        const first = await mgr.get_new_column(1, '7');
        for (let i = 0; i < 5; i++) {
            const again = await mgr.get_new_column(1, '7');
            expect(String(again._id)).toBe(String(first._id));
            expect(again.field).toBe('b');
        }
        expect(coll.docs).toHaveLength(2);
    });

    it('adds a new placeholder once the last one is switched on', async () => {
        const coll = fake_columns([
            { _id: new ObjectId(), field: 'a', headerName: 'Name', col_index: 1 }
        ]);
        const mgr = manager_with(coll);
        await mgr.get_new_column(1, '7');
        Object.assign(coll.docs[1], { headerName: 'Price', deleted: false });
        const next = await mgr.get_new_column(1, '7');
        expect(next).toMatchObject({ field: 'c', col_index: 3, deleted: true });
        expect(coll.docs).toHaveLength(3);
    });

    it("doesn't reuse a deleted column that had a name", async () => {
        const coll = fake_columns([
            { _id: new ObjectId(), field: 'a', headerName: 'Name', col_index: 1 },
            { _id: new ObjectId(), field: 'b', headerName: 'Old', col_index: 2, deleted: true }
        ]);
        const col = await manager_with(coll).get_new_column(1, '7');
        expect(col).toMatchObject({ field: 'c', col_index: 3 });
        expect(coll.docs).toHaveLength(3);
    });
});
