import { HttpException, HttpStatus } from '@nestjs/common';
import { ObjectId } from 'mongodb';
import {
    TrackingManager,
    account_lock_change,
    request_window,
    requests_per_minute,
    DEFAULT_MAX_REQUESTS_PER_MINUTE,
    RESERVATION_TTL_MS
} from './tracking.manager';

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

    it('allows saving every column of a 30-column table', async () => {
        const { manager, active } = make_manager(30, 0);
        const columns = active.map((_id, i) => ({ _id, headerName: `c${i}`, deleted: false }));
        await expect(
            manager.add_columns(account, { file_id: FILE_ID, columns })
        ).resolves.toBeUndefined();
    });
});

describe('TrackingManager.create_columns (batch create)', () => {
    const cols = (n: number) =>
        Array.from({ length: n }, (_, i) => ({ field: `x${i}`, headerName: `x${i}` }));

    it('counts every column that is not deleted, and refuses past 52', async () => {
        const { manager } = make_manager(50, 0);
        await expect(
            manager.create_columns(account, { file_id: FILE_ID, columns: cols(2) })
        ).resolves.toBeUndefined();
        await expect(
            manager.create_columns(account, { file_id: FILE_ID, columns: cols(3) })
        ).rejects.toMatchObject({ status: HttpStatus.FORBIDDEN });
    });

    it("doesn't count columns created deleted", async () => {
        const { manager } = make_manager(52, 0);
        const columns = [{ field: 'x', deleted: true }];
        await expect(
            manager.create_columns(account, { file_id: FILE_ID, columns })
        ).resolves.toBeUndefined();
    });
});

// ---- An in-memory Mongo with just the operations TrackingManager uses ----

// Every fake call yields, so parallel calls interleave as real ones do
const tick = () => new Promise(resolve => setImmediate(resolve));

function same(a, b) {
    if (a instanceof ObjectId && b instanceof ObjectId) return a.equals(b);
    return a === b;
}

function matches(doc, query) {
    return Object.entries(query || {}).every(([key, cond]: [string, any]) => {
        const value = doc[key];
        if (cond && typeof cond === 'object' && !(cond instanceof ObjectId)) {
            if ('$lte' in cond && !(value <= cond.$lte)) return false;
            if ('$gt' in cond && !(value > cond.$gt)) return false;
            if ('$ne' in cond && same(value, cond.$ne)) return false;
            if ('$in' in cond && !cond.$in.some(v => same(value ?? null, v))) return false;
            return true;
        }
        return same(value, cond);
    });
}

class FakeCollection {
    docs: any[] = [];

    async insertOne(doc) {
        await tick();
        const _id = doc._id ?? new ObjectId();
        this.docs.push({ ...doc, _id });
        return { insertedId: _id };
    }

    async deleteOne(query) {
        await tick();
        const i = this.docs.findIndex(d => matches(d, query));
        if (i >= 0) this.docs.splice(i, 1);
    }

    async deleteMany(query) {
        await tick();
        this.docs = this.docs.filter(d => !matches(d, query));
    }

    find(query) {
        return {
            toArray: async () => {
                await tick();
                return this.docs.filter(d => matches(d, query)).map(d => ({ ...d }));
            }
        };
    }

    async findOne(query = {}) {
        await tick();
        return this.docs.find(d => matches(d, query)) ?? null;
    }

    // Atomic, like Mongo's: the find, the upsert and the $inc happen in one step
    async findOneAndUpdate(query, update) {
        await tick();
        let doc = this.docs.find(d => matches(d, query));
        if (!doc) {
            doc = { ...query };
            this.docs.push(doc);
        }
        for (const [k, v] of Object.entries(update.$inc || {})) {
            doc[k] = (doc[k] || 0) + (v as number);
        }
        return { ...doc };
    }

    async countDocuments(query = {}) {
        await tick();
        return this.docs.filter(d => matches(d, query)).length;
    }

    async estimatedDocumentCount() {
        await tick();
        return this.docs.length;
    }

    async updateOne() {
        await tick();
    }
}

const LIMITS = { max_tables: 3, max_rows: 10, max_requests_per_minute: 5 };

function make_store(limits: any = LIMITS) {
    const named: Record<string, FakeCollection> = {};
    const collection = (name: string) => (named[name] = named[name] || new FakeCollection());
    collection('tracking:limits').docs.push({ _id: new ObjectId(), ...limits });
    const collections = {
        get_collection: async (_acct, name) => collection(name),
        get_dg_collection: async (type, _acct, file_id) => collection(`${type}:${file_id}`)
    };
    return { collections, collection };
}

const outcome = (p: Promise<unknown>): Promise<any> =>
    p.then(
        () => 'ok',
        e => e
    );

describe('request_window', () => {
    it('is a whole minute, starting on the minute', () => {
        const t = Date.UTC(2026, 10, 25, 12, 30, 0);
        expect(request_window(t)).toEqual({ start: t, retry_after_s: 60 });
        expect(request_window(t + 12_000)).toEqual({ start: t, retry_after_s: 48 });
        expect(request_window(t + 59_999)).toEqual({ start: t, retry_after_s: 1 });
        expect(request_window(t + 60_000).start).toBe(t + 60_000);
    });

    it('falls back to the Free limit when a plan has none', () => {
        expect(requests_per_minute(null)).toBe(DEFAULT_MAX_REQUESTS_PER_MINUTE);
        expect(requests_per_minute(undefined)).toBe(DEFAULT_MAX_REQUESTS_PER_MINUTE);
        expect(requests_per_minute(0)).toBe(DEFAULT_MAX_REQUESTS_PER_MINUTE);
        expect(requests_per_minute('1000')).toBe(1000);
    });
});

describe('TrackingManager.update_req_count', () => {
    const T0 = Date.UTC(2026, 10, 25, 12, 0, 0);

    function setup(limits: any = LIMITS) {
        const { collections, collection } = make_store(limits);
        const manager = new TrackingManager(collections as any, null, null, null);
        let clock = T0;
        manager.now = () => clock;
        return { manager, collection, set_clock: (t: number) => (clock = t) };
    }

    it('allows the limit per minute, then answers 429 with Retry-After until the next minute', async () => {
        const { manager, set_clock } = setup();
        for (let i = 0; i < 5; i++) await manager.update_req_count(account);
        // Later in the same minute, where the old 12-second window had already started again
        set_clock(T0 + 45_000);
        const err = await outcome(manager.update_req_count(account));
        expect(err).toBeInstanceOf(HttpException);
        expect(err.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
        expect(err.getResponse()).toMatchObject({
            message: 'External API request limit exceeded for current subscription',
            retry_after: 15
        });
        set_clock(T0 + 60_000);
        await expect(manager.update_req_count(account)).resolves.toBeUndefined();
    });

    it('counts parallel calls atomically', async () => {
        const { manager } = setup();
        const results = await Promise.all(
            Array.from({ length: 12 }, () => outcome(manager.update_req_count(account)))
        );
        expect(results.filter(r => r === 'ok')).toHaveLength(5);
        expect(results.filter(r => r !== 'ok').every(e => e.getStatus() === 429)).toBe(true);
    });

    it('drops earlier windows when a new one starts', async () => {
        const { manager, collection, set_clock } = setup();
        await manager.update_req_count(account);
        set_clock(T0 + 3 * 60_000);
        await manager.update_req_count(account);
        expect(collection('tracking:req_count').docs).toEqual([{ _id: T0 + 3 * 60_000, count: 1 }]);
    });

    it("doesn't treat a plan with no limit as unlimited", async () => {
        const { manager } = setup({ ...LIMITS, max_requests_per_minute: null });
        const results = await Promise.all(
            Array.from({ length: DEFAULT_MAX_REQUESTS_PER_MINUTE + 3 }, () =>
                outcome(manager.update_req_count(account))
            )
        );
        expect(results.filter(r => r === 'ok')).toHaveLength(DEFAULT_MAX_REQUESTS_PER_MINUTE);
    });
});

describe('TrackingManager row and table reservations', () => {
    const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

    function setup() {
        const { collections, collection } = make_store();
        const tables = { count: 0 };
        const file_directory_repository = {
            countBy: async () => {
                await tick();
                return tables.count;
            },
            update: async () => undefined
        };
        const manager = new TrackingManager(
            collections as any,
            null,
            null,
            file_directory_repository as any
        );
        const rows = collection(`data_grid_row:${FILE_ID}`);
        const add_saved_rows = (n: number) => {
            for (let i = 0; i < n; i++) rows.docs.push({ _id: new ObjectId() });
        };
        return { manager, collection, rows, add_saved_rows, tables };
    }

    type Setup = ReturnType<typeof setup>;

    // A row write as the services make one: reserve, write a while later, release
    async function write_rows(s: Setup, n: number, delay: number) {
        const release = await s.manager.add_rows(account, {
            file_id: FILE_ID,
            rows_to_be_added: n
        });
        try {
            await sleep(delay);
            s.add_saved_rows(n);
        } finally {
            await release();
        }
    }

    it('lets rows in up to the limit, and refuses past it', async () => {
        const s = setup();
        s.add_saved_rows(9);
        await write_rows(s, 1, 0);
        await expect(write_rows(s, 1, 0)).rejects.toMatchObject({
            status: HttpStatus.FORBIDDEN
        });
        expect(s.rows.docs).toHaveLength(10);
    });

    it("parallel row writes at the limit - 1 can't pass it", async () => {
        for (let run = 0; run < 20; run++) {
            const s = setup();
            s.add_saved_rows(9);
            const results = await Promise.allSettled(
                Array.from({ length: 6 }, () => write_rows(s, 1, Math.random() * 5))
            );
            expect(s.rows.docs.length).toBeLessThanOrEqual(10);
            const refused = results.filter(r => r.status === 'rejected');
            expect(refused.length).toBeGreaterThanOrEqual(5);
            // Every hold was released, written or not
            expect(s.collection('tracking:reservation').docs).toHaveLength(0);
        }
    });

    it('releases the hold when the write fails', async () => {
        const s = setup();
        s.add_saved_rows(9);
        const release = await s.manager.add_rows(account, {
            file_id: FILE_ID,
            rows_to_be_added: 1
        });
        await expect(write_rows(s, 1, 0)).rejects.toMatchObject({
            status: HttpStatus.FORBIDDEN
        });
        await release(); // that write failed: nothing saved
        await expect(write_rows(s, 1, 0)).resolves.toBeUndefined();
    });

    it('lets a hold left by a crashed write expire', async () => {
        const s = setup();
        const T0 = Date.UTC(2026, 10, 25);
        s.manager.now = () => T0;
        // Never released
        await s.manager.add_rows(account, { file_id: FILE_ID, rows_to_be_added: 10 });
        await expect(write_rows(s, 1, 0)).rejects.toMatchObject({
            status: HttpStatus.FORBIDDEN
        });
        s.manager.now = () => T0 + RESERVATION_TTL_MS + 1;
        await expect(write_rows(s, 1, 0)).resolves.toBeUndefined();
    });

    it("doesn't scan the table to count its rows", async () => {
        const s = setup();
        const scan = jest.spyOn(s.rows, 'countDocuments');
        await write_rows(s, 1, 0);
        await s.manager.deleted_rows(account, { file_id: FILE_ID });
        expect(scan).not.toHaveBeenCalled();
    });

    it("parallel table creates at the limit - 1 can't pass it", async () => {
        for (let run = 0; run < 20; run++) {
            const s = setup();
            s.tables.count = 2;
            const create = async () => {
                const release = await s.manager.add_table(account);
                try {
                    await sleep(Math.random() * 5);
                    s.tables.count++;
                } finally {
                    await release();
                }
            };
            const results = await Promise.allSettled(Array.from({ length: 5 }, create));
            expect(s.tables.count).toBeLessThanOrEqual(3);
            const refused = results.filter(r => r.status === 'rejected') as PromiseRejectedResult[];
            expect(refused.length).toBeGreaterThanOrEqual(4);
            expect(refused.every(r => r.reason.status === HttpStatus.FORBIDDEN)).toBe(true);
        }
    });
});

describe('account locks', () => {
    const TABLE_LIMIT = 'Table limit exceeded for current subscription';

    it('only lifts a lock it set', () => {
        expect(account_lock_change(true, TABLE_LIMIT, false)).toBe('unlock');
        expect(account_lock_change(true, 'unpaid', false)).toBeNull();
        expect(account_lock_change(false, null, false)).toBeNull();
    });

    it("locks an unlocked account over the limit, and doesn't overwrite another lock", () => {
        expect(account_lock_change(false, null, true)).toBe('lock');
        expect(account_lock_change(true, 'unpaid', true)).toBeNull();
        expect(account_lock_change(true, TABLE_LIMIT, true)).toBeNull();
    });

    function setup(saved: any, table_count: number) {
        const { collections } = make_store();
        const account_repository = {
            findOneBy: jest.fn(async () => saved),
            update: jest.fn(async () => undefined)
        };
        const file_directory_repository = { countBy: async () => table_count };
        const manager = new TrackingManager(
            collections as any,
            account_repository as any,
            null,
            file_directory_repository as any
        );
        return { manager, account_repository };
    }

    it("deleting a table doesn't lift a lock set for another reason", async () => {
        const { manager, account_repository } = setup(
            { id: 3, locked: true, locked_reason: 'unpaid' },
            1
        );
        await manager.deleted_table(account);
        expect(account_repository.update).not.toHaveBeenCalled();
    });

    it('deleting a table lifts the table-limit lock once under the limit', async () => {
        const { manager, account_repository } = setup(
            { id: 3, locked: true, locked_reason: TABLE_LIMIT },
            3
        );
        await manager.deleted_table(account);
        expect(account_repository.update).toHaveBeenCalledWith(
            { id: 3 },
            { locked: false, locked_reason: null }
        );
    });

    it('locks an account over the table limit', async () => {
        const { manager, account_repository } = setup({ id: 3, locked: false }, 4);
        await manager.update_account_lock(account);
        expect(account_repository.update).toHaveBeenCalledWith(
            { id: 3 },
            { locked: true, locked_reason: TABLE_LIMIT }
        );
    });
});
