import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { UrlSyncProcessor } from './url-sync-processor';
import { WebFileManager } from './web-file.manager';

// In-memory stand-ins for the two grid collections: just what the sync uses
class FakeCollection {
    docs: any[] = [];
    private matches = (doc, filter) => Object.keys(filter).every(k => match(doc[k], filter[k]));

    find(filter = {}) {
        return { toArray: async () => this.docs.filter(d => this.matches(d, filter)) };
    }
    async findOne(filter, opts?) {
        let docs = this.docs.filter(d => this.matches(d, filter));
        if (opts && opts.sort && opts.sort.row_index === -1) {
            docs = [...docs].sort((a, b) => b.row_index - a.row_index);
        }
        return docs[0] || null;
    }
    async insertMany(docs) {
        this.docs.push(...docs.map(d => ({ ...d })));
    }
    async deleteMany() {
        this.docs = [];
    }
    async countDocuments() {
        return this.docs.length;
    }
    async distinct(field, filter) {
        return [...new Set(this.docs.filter(d => this.matches(d, filter)).map(d => d[field]))];
    }
    async bulkWrite(ops) {
        let upsertedCount = 0;
        let matchedCount = 0;
        for (const { updateOne } of ops) {
            const doc = this.docs.find(d => this.matches(d, updateOne.filter));
            if (doc) {
                Object.assign(doc, updateOne.update.$set);
                matchedCount++;
            } else {
                this.docs.push({
                    ...updateOne.filter,
                    ...updateOne.update.$set,
                    ...(updateOne.update.$setOnInsert || {})
                });
                upsertedCount++;
            }
        }
        return { upsertedCount, matchedCount };
    }
}

function match(value, condition) {
    if (condition && typeof condition === 'object' && '$in' in condition) {
        return condition.$in.includes(value);
    }
    return value === condition;
}

const FILE_ID = 7;
const account = { id: 1 };

function setup(max_rows = 100) {
    const rows = new FakeCollection();
    const cols = new FakeCollection();
    const collections: any = {
        get_dg_row: async () => rows,
        get_dg_col: async () => cols
    };
    const tracking: any = {
        refreshed: 0,
        async check_storage() {},
        async validate_row_count(_a, n) {
            if (n > max_rows) throw new Error('Row count limit exceeded for current subscription');
        },
        async validate_column_count(_a, _f, n) {
            const live = cols.docs.filter(c => !c.deleted).length;
            if (live + n > 52) throw new Error('Column count limit exceeded');
        },
        async refresh_row_count() {
            tracking.refreshed++;
        }
    };
    const manager = new WebFileManager(collections, tracking, null);
    const processor = new UrlSyncProcessor(collections, manager, tracking);
    cols.docs = [
        { field: 'a', headerName: 'email', col_index: 1, order: 1 },
        { field: 'b', headerName: 'name', col_index: 2, order: 2 },
        { field: 'c', headerName: 'age', col_index: 3, order: 3, col_type: 'number' },
        { field: 'd', headerName: 'old', col_index: 4, order: 4, deleted: true }
    ];
    rows.docs = [
        { file_directory_id: FILE_ID, row_index: 1, a: 'ann@x.com', b: 'Ann', c: 30 },
        { file_directory_id: FILE_ID, row_index: 2, a: 'bo@x.com', b: 'Bo', c: 41 }
    ];
    return { rows, cols, tracking, processor };
}

let dir: string;
beforeAll(() => (dir = fs.mkdtempSync(path.join(os.tmpdir(), 'url-sync-'))));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

const csv_file = (text: string) => {
    const file = path.join(dir, `${Math.random().toString(36).slice(2)}.csv`);
    fs.writeFileSync(file, text);
    return file;
};

const replace = { mode: 'replace', key_column: null, schedule: 'off' } as const;
const upsert = { mode: 'upsert', key_column: 'email', schedule: 'off' } as const;

describe('UrlSyncProcessor', () => {
    it('replaces every row, matching columns by name and adding new ones', async () => {
        const { rows, cols, tracking, processor } = setup();
        const file = csv_file('name,email,city\nCy,cy@x.com,Oslo\nDi,di@x.com,Rome\n');
        const res = await processor.sync(account, FILE_ID, file, replace);
        expect(res).toMatchObject({ rows: 2, inserted: 2, new_columns: ['city'] });
        // "city" goes after the last column, deleted ones included
        expect(cols.docs.find(c => c.headerName === 'city')).toMatchObject({
            field: 'e',
            col_index: 5
        });
        expect(rows.docs.map(r => [r.row_index, r.a, r.b, r.e])).toEqual([
            [1, 'cy@x.com', 'Cy', 'Oslo'],
            [2, 'di@x.com', 'Di', 'Rome']
        ]);
        expect(tracking.refreshed).toBe(1);
    });

    it('upserts on the key column: updates matches, adds the rest, keeps other rows', async () => {
        const { rows, processor } = setup();
        const file = csv_file('email,age\nbo@x.com,42\nnew@x.com,7\n,99\n');
        const res = await processor.sync(account, FILE_ID, file, upsert);
        expect(res).toMatchObject({ rows: 2, inserted: 1, updated: 1, skipped: 1 });
        const by_email = Object.fromEntries(rows.docs.map(r => [r.a, r]));
        expect(by_email['ann@x.com']).toMatchObject({ b: 'Ann', c: 30 });
        // The column's type is kept: age is a number
        expect(by_email['bo@x.com']).toMatchObject({ b: 'Bo', c: 42, row_index: 2 });
        expect(by_email['new@x.com']).toMatchObject({ c: 7, row_index: 3 });
    });

    it('refuses a sync over the row limit before writing anything', async () => {
        const { rows, processor } = setup(3);
        const before = JSON.stringify(rows.docs);
        const four = 'email\na@x\nb@x\nc@x\nd@x\n';
        await expect(processor.sync(account, FILE_ID, csv_file(four), replace)).rejects.toThrow(
            /Row count limit/
        );
        // 2 rows + 2 new keys = 4 > 3; ann@x.com would be an update, not a new row
        const upserts = 'email\nann@x.com\nx@x\ny@x\n';
        await expect(processor.sync(account, FILE_ID, csv_file(upserts), upsert)).rejects.toThrow(
            /Row count limit/
        );
        expect(JSON.stringify(rows.docs)).toBe(before);
        // Exactly at the limit is fine
        const ok = await processor.sync(
            account,
            FILE_ID,
            csv_file('email\nann@x.com\nx@x\n'),
            upsert
        );
        expect(ok).toMatchObject({ inserted: 1, updated: 1 });
    });

    it('refuses bad sources before writing anything', async () => {
        const { rows, cols, processor } = setup();
        const before = JSON.stringify([rows.docs, cols.docs]);
        const bad = [
            ['name,name\na,b\n', replace, /Duplicate column/],
            ['row_num,x\n1,2\n', replace, /reserved/],
            ['email,x\na,b\nc\n', replace, /as many fields|Invalid Record Length/],
            [`email\n${'z'.repeat(2001)}\n`, replace, /longer than/],
            ['name\nAnn\n', upsert, /no "email" column/],
            ['', replace, /No data/]
        ] as const;
        for (const [text, settings, error] of bad) {
            await expect(
                processor.sync(account, FILE_ID, csv_file(text), settings)
            ).rejects.toThrow(error);
        }
        expect(JSON.stringify([rows.docs, cols.docs])).toBe(before);
    });

    it('tells the caller when a replace removed the old rows, and only then (#175)', async () => {
        const { rows, processor } = setup();
        let calls = 0;
        const on_replaced = async () => {
            // Called after the new rows are in
            expect(rows.docs.map(r => r.a)).toEqual(['cy@x.com']);
            calls++;
        };
        await processor.sync(account, FILE_ID, csv_file('email\ncy@x.com\n'), replace, on_replaced);
        expect(calls).toBe(1);
        // An upsert removes no rows, and a refused sync writes nothing
        await processor.sync(account, FILE_ID, csv_file('email\ndi@x.com\n'), upsert, on_replaced);
        await expect(
            processor.sync(account, FILE_ID, csv_file('name,name\na,b\n'), replace, on_replaced)
        ).rejects.toThrow(/Duplicate column/);
        expect(calls).toBe(1);
    });

    it('stops when the table is deleted', async () => {
        const { processor } = setup();
        const lines = ['email'];
        for (let i = 0; i < 5000; i++) lines.push(`u${i}@x.com`);
        const running = processor.sync(
            account,
            FILE_ID,
            csv_file(lines.join('\n') + '\n'),
            replace
        );
        processor.cancel(FILE_ID);
        await expect(running).rejects.toThrow('File delete request');
    });
});
