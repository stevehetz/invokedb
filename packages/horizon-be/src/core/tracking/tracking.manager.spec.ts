import { HttpException, HttpStatus } from '@nestjs/common';
import { ObjectId } from 'mongodb';
import {
    TrackingManager,
    account_lock_change,
    estimate_bytes,
    RESERVATION_TTL_MS,
    STORAGE_CACHE_MS,
    TABLE_LOCK_REASON
} from './tracking.manager';
import { PLANS, PLAN_IDS, PLAN_SUBSCRIPTIONS, PlanId, MAX_COLUMNS } from '../plan/plans';

const FILE_ID = 7;

// An account on a plan (today's subscription ids map to the plans)
const on_plan = (plan_id: PlanId, id = 3) => ({
    id,
    email: `user${id}@example.com`,
    email_verified: true,
    subscription_id: PLAN_SUBSCRIPTIONS[plan_id]
});
const internal = { id: 4, email: 'demo@invokedb.com', email_verified: true, subscription_id: null };

// ---- An in-memory Mongo with just the operations TrackingManager uses ----

// Every fake call yields, so parallel calls interleave as real ones do
const tick = () => new Promise(resolve => setImmediate(resolve));

function same(a, b) {
    if (a instanceof ObjectId && b instanceof ObjectId) return a.equals(b);
    return a === b;
}

function matches(doc, query) {
    return Object.entries(query || {}).every(([key, cond]: [string, any]) => {
        if (key === '$or') return cond.some(q => matches(doc, q));
        const value = doc[key];
        if (cond && typeof cond === 'object' && !(cond instanceof ObjectId)) {
            // Like Mongo's, comparisons only match values of the same type
            if ('$lt' in cond && !(typeof value === typeof cond.$lt && value < cond.$lt))
                return false;
            if ('$lte' in cond && !(value <= cond.$lte)) return false;
            if ('$gt' in cond && !(value > cond.$gt)) return false;
            if ('$in' in cond && !cond.$in.some(v => same(value ?? null, v))) return false;
            return true;
        }
        return same(value, cond);
    });
}

class FakeCollection {
    docs: any[] = [];
    // Rows that "exist" without being in `docs`, so a test can fill a table to a big cap
    extra = 0;

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

    // Atomic, like Mongo's: the find, the upsert and the $inc happen in one step. An upsert
    // whose query doesn't match but whose `_id` exists fails with a duplicate key, as in Mongo.
    async findOneAndUpdate(query, update, opts: any = {}) {
        await tick();
        let doc = this.docs.find(d => matches(d, query));
        if (!doc) {
            if (!opts.upsert) return null;
            if (this.docs.some(d => same(d._id, query._id))) {
                throw Object.assign(new Error('E11000 duplicate key'), { code: 11000 });
            }
            doc = { _id: query._id };
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
        return this.docs.length + this.extra;
    }

    async updateOne() {
        await tick();
    }
}

function make_store() {
    const named: Record<string, FakeCollection> = {};
    const collection = (name: string) => (named[name] = named[name] || new FakeCollection());
    const db = { dataSize: 0, stats_calls: 0 };
    const collections = {
        get_collection: async (_acct, name) => collection(name),
        get_dg_collection: async (type, _acct, file_id) => collection(`${type}:${file_id}`),
        get_dg_collection_name: (type, file_id) => `${type}:${file_id}`,
        get_db_name: acct => `db:${acct}`,
        get_mongo_db: async () => ({
            collection: (name: string) => collection(name.replace(/:acct_\d+$/, '')),
            stats: async () => {
                db.stats_calls++;
                return { dataSize: db.dataSize };
            }
        })
    };
    return { collections, collection, db };
}

function setup(account: any = on_plan('FREE')) {
    const { collections, collection, db } = make_store();
    // The account's tables (Postgres): ids, and how many there are
    const tables = { ids: [FILE_ID] as number[], extra: 0 };
    const file_directory_repository = {
        countBy: async () => {
            await tick();
            return tables.ids.length + tables.extra;
        },
        findBy: async () => tables.ids.map(id => ({ id, name: `t${id}` })),
        findOneBy: async () => null,
        update: async () => undefined
    };
    const manager = new TrackingManager(collections as any, null, file_directory_repository as any);
    const rows = (file_id = FILE_ID) => collection(`data_grid_row:${file_id}`);
    const cols = (file_id = FILE_ID) => collection(`data_grid_column:${file_id}`);
    const add_saved_rows = (n: number, file_id = FILE_ID) => {
        for (let i = 0; i < n; i++) rows(file_id).docs.push({ _id: new ObjectId() });
    };
    return { manager, collection, rows, cols, add_saved_rows, tables, db, account };
}

type Setup = ReturnType<typeof setup>;

const outcome = (p: Promise<unknown>): Promise<any> =>
    p.then(
        () => 'ok',
        e => e
    );

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// A row write as the services make one: reserve, write a while later, release
async function write_rows(s: Setup, n: number, delay = 0, file_id = FILE_ID, bytes = 0) {
    const release = await s.manager.add_rows(s.account, {
        file_id,
        rows_to_be_added: n,
        bytes
    });
    try {
        await sleep(delay);
        s.add_saved_rows(n, file_id);
    } finally {
        await release();
    }
}

function expect_plan_limit(err: any, limit: string, cap: any, status = HttpStatus.FORBIDDEN) {
    expect(err).toBeInstanceOf(HttpException);
    expect(err.getStatus()).toBe(status);
    expect(err.getResponse()).toMatchObject({ code: 'plan_limit', limit, cap });
}

describe.each(PLAN_IDS)('TrackingManager on %s', plan_id => {
    const caps = PLANS[plan_id].caps;
    const account = on_plan(plan_id);

    describe('tables', () => {
        it('allows a table at the cap - 1 and refuses one at the cap', async () => {
            const s = setup(account);
            s.tables.extra = caps.tables - 2; // with FILE_ID: cap - 1 tables
            const release = await s.manager.add_table(account);
            s.tables.extra++;
            await release();
            expect_plan_limit(await outcome(s.manager.add_table(account)), 'tables', caps.tables);
        });

        it("parallel creates at the cap - 1 can't pass it", async () => {
            const s = setup(account);
            s.tables.extra = caps.tables - 2;
            const create = async () => {
                const release = await s.manager.add_table(account);
                try {
                    await sleep(Math.random() * 5);
                    s.tables.extra++;
                } finally {
                    await release();
                }
            };
            const results = await Promise.allSettled(Array.from({ length: 4 }, create));
            expect(s.tables.ids.length + s.tables.extra).toBeLessThanOrEqual(caps.tables);
            const refused = results.filter(r => r.status === 'rejected') as PromiseRejectedResult[];
            expect(refused.length).toBeGreaterThanOrEqual(3);
            refused.forEach(r => expect_plan_limit(r.reason, 'tables', caps.tables));
        });
    });

    describe('rows per table', () => {
        it('lets rows in up to the cap, and refuses past it', async () => {
            const s = setup(account);
            s.rows().extra = caps.rows_per_table - 1;
            await write_rows(s, 1);
            expect_plan_limit(
                await outcome(write_rows(s, 1)),
                'rows_per_table',
                caps.rows_per_table
            );
        });

        it('refuses a batch that crosses the cap whole', async () => {
            const s = setup(account);
            s.rows().extra = caps.rows_per_table - 5;
            expect_plan_limit(
                await outcome(write_rows(s, 6)),
                'rows_per_table',
                caps.rows_per_table
            );
            expect(s.rows().docs).toHaveLength(0);
        });

        it('a bulk write (CSV, URL sync) is checked against the cap', async () => {
            const s = setup(account);
            await expect(
                s.manager.validate_row_count(account, caps.rows_per_table, FILE_ID)
            ).resolves.toBeUndefined();
            expect_plan_limit(
                await outcome(s.manager.validate_row_count(account, caps.rows_per_table + 1)),
                'rows_per_table',
                caps.rows_per_table
            );
        });
    });

    describe('rows per account', () => {
        // Other tables (ids 100, 101...) holding `total` rows, none past the per-table cap.
        // Answers the first of them.
        function fill_others(s: Setup, total: number) {
            let id = 100;
            for (let left = total; left > 0; id++) {
                const n = Math.min(caps.rows_per_table, left);
                s.tables.ids.push(id);
                s.rows(id).extra = n;
                left -= n;
            }
            return 100;
        }

        it('sums every table, and refuses a write past the cap', async () => {
            const s = setup(account);
            fill_others(s, caps.rows_per_account - 1);
            await write_rows(s, 1);
            expect_plan_limit(
                await outcome(write_rows(s, 1)),
                'rows_per_account',
                caps.rows_per_account
            );
        });

        it('deleting rows frees room', async () => {
            const s = setup(account);
            const other = fill_others(s, caps.rows_per_account - 1);
            await write_rows(s, 1);
            s.rows(other).extra -= 1;
            await expect(write_rows(s, 1)).resolves.toBeUndefined();
        });

        it('a bulk write (CSV, URL sync) counts the other tables', async () => {
            const s = setup(account);
            fill_others(s, caps.rows_per_account - 10);
            await expect(
                s.manager.validate_row_count(account, 10, FILE_ID)
            ).resolves.toBeUndefined();
            expect_plan_limit(
                await outcome(s.manager.validate_row_count(account, 11, FILE_ID)),
                'rows_per_account',
                caps.rows_per_account
            );
        });

        it("parallel writes at the cap - 1 can't pass it", async () => {
            const s = setup(account);
            fill_others(s, caps.rows_per_account - 1);
            s.tables.ids.push(8);
            const results = await Promise.allSettled(
                Array.from({ length: 5 }, (_, i) =>
                    write_rows(s, 1, Math.random() * 5, i % 2 ? FILE_ID : 8)
                )
            );
            expect(results.filter(r => r.status === 'fulfilled').length).toBeLessThanOrEqual(1);
            const refused = results.filter(r => r.status === 'rejected') as PromiseRejectedResult[];
            refused.forEach(r =>
                expect_plan_limit(r.reason, 'rows_per_account', caps.rows_per_account)
            );
            expect(s.collection('tracking:reservation').docs).toHaveLength(0);
        });
    });

    describe('storage', () => {
        it("reads the account database's size, and refuses a write past the cap", async () => {
            const s = setup(account);
            s.db.dataSize = caps.storage_bytes - 100;
            await expect(write_rows(s, 1, 0, FILE_ID, 100)).resolves.toBeUndefined();
            expect_plan_limit(
                await outcome(write_rows(s, 1, 0, FILE_ID, 1)),
                'storage_bytes',
                caps.storage_bytes
            );
            expect_plan_limit(
                await outcome(s.manager.check_storage(account, 1)),
                'storage_bytes',
                caps.storage_bytes
            );
        });

        it('caches the size briefly', async () => {
            const s = setup(account);
            const T0 = Date.UTC(2026, 10, 25);
            s.manager.now = () => T0;
            await s.manager.check_storage(account, 0);
            await s.manager.check_storage(account, 0);
            expect(s.db.stats_calls).toBe(1);
            s.manager.now = () => T0 + STORAGE_CACHE_MS;
            await s.manager.check_storage(account, 0);
            expect(s.db.stats_calls).toBe(2);
        });
    });

    describe('columns', () => {
        const cap = Math.min(caps.columns_per_table, MAX_COLUMNS);

        function with_columns(active: number, placeholders: number) {
            const s = setup(account);
            for (let i = 0; i < active; i++) {
                s.cols().docs.push({ _id: new ObjectId(), deleted: false });
            }
            for (let i = 0; i < placeholders; i++) {
                s.cols().docs.push({ _id: new ObjectId(), deleted: true });
            }
            const ids = (deleted: boolean) =>
                s
                    .cols()
                    .docs.filter(d => d.deleted === deleted)
                    .map(d => String(d._id));
            return { s, active: ids(false), placeholders: ids(true) };
        }

        it('turning a column on past the cap is refused; up to it is allowed', async () => {
            const { s, placeholders } = with_columns(cap - 1, 2);
            const one = [{ _id: placeholders[0], deleted: false }];
            await expect(
                s.manager.add_columns(account, { file_id: FILE_ID, columns: one })
            ).resolves.toBeUndefined();
            const two = placeholders.map(_id => ({ _id, deleted: false }));
            expect_plan_limit(
                await outcome(s.manager.add_columns(account, { file_id: FILE_ID, columns: two })),
                'columns_per_table',
                cap
            );
        });

        it('only new columns count: saving every column of a full table is allowed', async () => {
            const { s, active } = with_columns(cap, 3);
            const columns = active.map((_id, i) => ({ _id, order: i, width: 120, deleted: false }));
            await expect(
                s.manager.add_columns(account, { file_id: FILE_ID, columns })
            ).resolves.toBeUndefined();
        });

        it('a batch create counts each column that is not deleted', async () => {
            const { s } = with_columns(cap - 2, 0);
            const cols = (n: number) => Array.from({ length: n }, (_, i) => ({ field: `x${i}` }));
            await expect(
                s.manager.create_columns(account, { file_id: FILE_ID, columns: cols(2) })
            ).resolves.toBeUndefined();
            expect_plan_limit(
                await outcome(
                    s.manager.create_columns(account, {
                        file_id: FILE_ID,
                        columns: [...cols(3), { field: 'y', deleted: true }]
                    })
                ),
                'columns_per_table',
                cap
            );
        });

        it('a CSV or URL sync with too many columns is refused', async () => {
            const { s } = with_columns(0, 0);
            await expect(
                s.manager.validate_column_count(account, FILE_ID, cap)
            ).resolves.toBeUndefined();
            expect_plan_limit(
                await outcome(s.manager.validate_column_count(account, FILE_ID, cap + 1)),
                'columns_per_table',
                cap
            );
        });
    });

    describe('API calls', () => {
        const T0 = Date.UTC(2026, 10, 30, 23, 59, 0);

        function api(s = setup(account)) {
            let clock = T0;
            s.manager.now = () => clock;
            return { ...s, set_clock: (t: number) => (clock = t) };
        }

        it('counts each call in the UTC month with $inc, and answers 429 at the quota', async () => {
            const s = api();
            s.collection('tracking:api_month').docs.push({
                _id: '2026-11',
                count: caps.api_calls_per_month - 1
            });
            await expect(s.manager.update_req_count(account)).resolves.toBeUndefined();
            expect(await s.manager.api_calls_this_month(account)).toBe(caps.api_calls_per_month);
            s.set_clock(T0 + 30_000); // a fresh rate-limit token
            const err = await outcome(s.manager.update_req_count(account));
            expect_plan_limit(
                err,
                'api_calls_per_month',
                caps.api_calls_per_month,
                HttpStatus.TOO_MANY_REQUESTS
            );
            // Retry-After: until the 1st (UTC)
            expect(err.getResponse().retry_after).toBe(30);
            // A refused call isn't counted
            expect(await s.manager.api_calls_this_month(account)).toBe(caps.api_calls_per_month);
        });

        it('starts again on the 1st (UTC)', async () => {
            const s = api();
            s.collection('tracking:api_month').docs.push({
                _id: '2026-11',
                count: caps.api_calls_per_month
            });
            expect((await outcome(s.manager.update_req_count(account))).getStatus()).toBe(429);
            s.set_clock(Date.UTC(2026, 11, 1, 0, 0, 1));
            await expect(s.manager.update_req_count(account)).resolves.toBeUndefined();
            expect(await s.manager.api_calls_this_month(account)).toBe(1);
        });

        it("parallel calls at the quota - 1 can't pass it", async () => {
            const s = api();
            s.collection('tracking:api_month').docs.push({
                _id: '2026-11',
                count: caps.api_calls_per_month - 1
            });
            const results = await Promise.all(
                Array.from({ length: 5 }, () => outcome(s.manager.update_req_count(account)))
            );
            expect(results.filter(r => r === 'ok')).toHaveLength(1);
        });

        it('allows a burst, then answers 429 with Retry-After until a token is back', async () => {
            const s = api();
            for (let i = 0; i < caps.api_rate_burst; i++) {
                await s.manager.update_req_count(account);
            }
            const err = await outcome(s.manager.update_req_count(account));
            expect_plan_limit(
                err,
                'api_rate_per_second',
                caps.api_rate_per_second,
                HttpStatus.TOO_MANY_REQUESTS
            );
            expect(err.getResponse().retry_after).toBe(1);
            s.set_clock(T0 + 1000);
            await expect(s.manager.update_req_count(account)).resolves.toBeUndefined();
            // The refused call wasn't counted against the month
            expect(await s.manager.api_calls_this_month(account)).toBe(caps.api_rate_burst + 1);
        });

        it('limits each account on its own', async () => {
            const s = api();
            for (let i = 0; i < caps.api_rate_burst; i++) {
                await s.manager.update_req_count(account);
            }
            const other = on_plan(plan_id, 9);
            await expect(s.manager.update_req_count(other)).resolves.toBeUndefined();
        });
    });
});

describe('TrackingManager on an internal account', () => {
    it('has no counted caps', async () => {
        const s = setup(internal);
        s.tables.extra = 10_000;
        s.rows().extra = 50_000_000;
        s.db.dataSize = 1e12;
        await expect(write_rows(s, 100)).resolves.toBeUndefined();
        const release = await s.manager.add_table(internal);
        await release();
        for (let i = 0; i < 500; i++) await s.manager.update_req_count(internal);
    });

    it("keeps Pro's column cap", async () => {
        const s = setup(internal);
        await expect(
            s.manager.validate_column_count(internal, FILE_ID, MAX_COLUMNS + 1)
        ).rejects.toMatchObject({ status: HttpStatus.FORBIDDEN });
    });
});

describe('TrackingManager reservations', () => {
    const account = on_plan('FREE');

    it('releases the hold when the write fails', async () => {
        const s = setup(account);
        s.rows().extra = PLANS.FREE.caps.rows_per_table - 1;
        const release = await s.manager.add_rows(account, {
            file_id: FILE_ID,
            rows_to_be_added: 1
        });
        await expect(write_rows(s, 1)).rejects.toMatchObject({ status: HttpStatus.FORBIDDEN });
        await release(); // that write failed: nothing saved
        await expect(write_rows(s, 1)).resolves.toBeUndefined();
    });

    it('lets a hold left by a crashed write expire', async () => {
        const s = setup(account);
        const T0 = Date.UTC(2026, 10, 25);
        s.manager.now = () => T0;
        // Never released
        await s.manager.add_rows(account, {
            file_id: FILE_ID,
            rows_to_be_added: PLANS.FREE.caps.rows_per_table
        });
        await expect(write_rows(s, 1)).rejects.toMatchObject({ status: HttpStatus.FORBIDDEN });
        s.manager.now = () => T0 + RESERVATION_TTL_MS + 1;
        await expect(write_rows(s, 1)).resolves.toBeUndefined();
    });

    it("doesn't scan the table to count its rows", async () => {
        const s = setup(account);
        const scan = jest.spyOn(s.rows(), 'countDocuments');
        await write_rows(s, 1);
        await s.manager.deleted_rows(account, { file_id: FILE_ID });
        expect(scan).not.toHaveBeenCalled();
    });
});

describe('estimate_bytes', () => {
    it("is the rows' JSON size", () => {
        expect(estimate_bytes([{ a: 'xyz' }])).toBe('[{"a":"xyz"}]'.length);
        expect(estimate_bytes(undefined)).toBe(4);
    });
});

describe('account locks', () => {
    it('only lifts a lock it set', () => {
        expect(account_lock_change(true, TABLE_LOCK_REASON, false)).toBe('unlock');
        expect(account_lock_change(true, 'unpaid', false)).toBeNull();
        expect(account_lock_change(false, null, false)).toBeNull();
    });

    it("locks an unlocked account over the limit, and doesn't overwrite another lock", () => {
        expect(account_lock_change(false, null, true)).toBe('lock');
        expect(account_lock_change(true, 'unpaid', true)).toBeNull();
        expect(account_lock_change(true, TABLE_LOCK_REASON, true)).toBeNull();
    });

    function lock_setup(saved: any, table_count: number) {
        const { collections } = make_store();
        const account_repository = {
            findOneBy: jest.fn(async () => saved),
            update: jest.fn(async () => undefined)
        };
        const file_directory_repository = { countBy: async () => table_count };
        const manager = new TrackingManager(
            collections as any,
            account_repository as any,
            file_directory_repository as any
        );
        return { manager, account_repository };
    }

    const free = on_plan('FREE');
    const cap = PLANS.FREE.caps.tables;

    it("deleting a table doesn't lift a lock set for another reason", async () => {
        const { manager, account_repository } = lock_setup(
            { id: 3, locked: true, locked_reason: 'unpaid' },
            1
        );
        await manager.deleted_table(free);
        expect(account_repository.update).not.toHaveBeenCalled();
    });

    it('deleting a table lifts the table-limit lock once under the limit', async () => {
        const { manager, account_repository } = lock_setup(
            { id: 3, locked: true, locked_reason: TABLE_LOCK_REASON },
            cap
        );
        await manager.deleted_table(free);
        expect(account_repository.update).toHaveBeenCalledWith(
            { id: 3 },
            { locked: false, locked_reason: null }
        );
    });

    it("deleting a table doesn't lock an account still over the limit", async () => {
        const { manager, account_repository } = lock_setup({ id: 3, locked: false }, cap + 2);
        await manager.deleted_table(free);
        expect(account_repository.update).not.toHaveBeenCalled();
    });

    it('a plan change locks an account over the table limit', async () => {
        const { manager, account_repository } = lock_setup({ id: 3, locked: false }, cap + 1);
        await manager.update_account_lock(free);
        expect(account_repository.update).toHaveBeenCalledWith(
            { id: 3 },
            { locked: true, locked_reason: TABLE_LOCK_REASON }
        );
    });
});
