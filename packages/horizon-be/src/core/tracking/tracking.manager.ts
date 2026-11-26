import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MongoDbCollections } from '../mongodb/collections';
import { Repository } from 'typeorm';
import { ObjectId } from 'mongodb';
import { Account } from '../account/account.entity';
import { FileDirectory } from '../file-directory/file-directory.entity';
import { KeyRateLimiter } from '../api-key/key-rate-limit';
import {
    AccountPlan,
    MAX_COLUMNS,
    account_plan,
    plan_limit_error,
    quota_month,
    seconds_to_next_month
} from '../plan/plans';
import { quota_level_to_send, quota_levels_up_to, QuotaLevel } from '../plan/quota-alert';
import { EmailManager } from '@app/email/email.manager';
import { api_quota_tmpl } from '@app/email/api-quota.template';
import env from '@app/env';

// The reason of a lock this code sets on an account over its table cap (and only lifts that one)
export const TABLE_LOCK_REASON = 'Table limit exceeded for current subscription';

export { MAX_COLUMNS };

// How long a reservation holds tables or rows if the write that made it never releases it
// (the process died mid-write). Writes release theirs as soon as they finish.
export const RESERVATION_TTL_MS = 10 * 60 * 1000;

// How long an account's storage (dbStats) is reused before it's read again
export const STORAGE_CACHE_MS = 30 * 1000;

/**
 * What the table count does to the account's lock. The account has one `locked` flag, so this
 * code only lifts a lock it set itself (its reason is the table-limit message), and doesn't
 * overwrite a lock set for another reason (#182).
 */
export function account_lock_change(
    locked: boolean,
    locked_reason: string | null,
    over_table_limit: boolean
): 'lock' | 'unlock' | null {
    if (over_table_limit) return locked ? null : 'lock';
    if (locked && locked_reason === TABLE_LOCK_REASON) return 'unlock';
    return null;
}

/** A rough size in bytes of rows about to be written (their JSON), for the storage cap. */
export function estimate_bytes(rows: unknown): number {
    try {
        return Buffer.byteLength(JSON.stringify(rows ?? null) || '', 'utf8');
    } catch {
        return 0;
    }
}

interface Hold {
    key: string;
    amount: number;
}

// Enforces the plan's caps (core/plan/plans.ts, #183) on every write that adds something:
// tables, rows (per table and for the whole account), storage, columns, and `/api/v1` calls
// (a monthly quota and a per-second rate limit per account).
@Injectable()
export class TrackingManager {
    private readonly rate_limiter: KeyRateLimiter;
    private readonly storage_cache = new Map<number, { bytes: number; at: number }>();
    // Quota emails being claimed and sent, off the API call's path (#274)
    private readonly quota_alerts = new Set<Promise<void>>();

    constructor(
        private _collections: MongoDbCollections,
        @InjectRepository(Account)
        private readonly account_repository: Repository<Account>,
        @InjectRepository(FileDirectory)
        private readonly file_directory_repository: Repository<FileDirectory>,
        private readonly email_manager?: EmailManager
    ) {
        this.rate_limiter = new KeyRateLimiter(() => this.now());
    }

    // The clock, replaceable in tests
    now: () => number = () => Date.now();

    async get_tracking_row_count_collection(account) {
        return await this._collections.get_collection(account.id, 'tracking:row_count', {
            db_name: env.HORIZON_MONGO_TRACKING_DB,
            mongo_uri: env.HORIZON_MONGO_TRACKING_URI
        });
    }

    // One document per UTC month (`_id` "2026-11") with the account's `/api/v1` call count
    private async get_api_month_collection(account) {
        return await this._collections.get_collection(account.id, 'tracking:api_month', {
            db_name: env.HORIZON_MONGO_TRACKING_DB,
            mongo_uri: env.HORIZON_MONGO_TRACKING_URI
        });
    }

    private async get_tracking_reservation_collection(account) {
        return await this._collections.get_collection(account.id, 'tracking:reservation', {
            db_name: env.HORIZON_MONGO_TRACKING_DB,
            mongo_uri: env.HORIZON_MONGO_TRACKING_URI
        });
    }

    /**
     * The account's plan and caps. The request's account is usually the whole entity; one
     * without its email (only an id) is read again.
     */
    async plan(account): Promise<AccountPlan> {
        if (account && account.email === undefined && account.id && this.account_repository) {
            const saved = await this.account_repository.findOneBy({ id: account.id });
            if (saved) return account_plan(saved);
        }
        return account_plan(account);
    }

    /**
     * Holds amounts of some limits (tables, a table's rows, the account's rows) while a write
     * runs, so parallel writes can't pass a cap together (#182). The holds are written first,
     * then `check` gets the sum of every live hold on each key, its own included, to add to the
     * saved count. Of two racing writes, the later hold sees the earlier one, or (once that is
     * released) its saved rows, so near the cap both may be refused but never both let through.
     * Answers the release, which the caller awaits once its write has finished or failed.
     */
    private async reserve(
        account,
        holds: Hold[],
        check: (held: Record<string, number>) => Promise<void>
    ): Promise<() => Promise<void>> {
        const c = await this.get_tracking_reservation_collection(account);
        const now = this.now();
        await c.deleteMany({ at: { $lte: now - RESERVATION_TTL_MS } });
        const ids = [];
        let released = false;
        const release = async () => {
            if (released) return;
            released = true;
            for (const _id of ids) {
                try {
                    await c.deleteOne({ _id });
                } catch (ex) {
                    // Never fails the write it follows: a hold left behind expires on its own
                    console.error(`Reservation not released: ${ex.message}`);
                }
            }
        };
        try {
            for (const h of holds) {
                const { insertedId } = await c.insertOne({ key: h.key, amount: h.amount, at: now });
                ids.push(insertedId);
            }
            const held: Record<string, number> = {};
            for (const h of holds) {
                const live = await c
                    .find({ key: h.key, at: { $gt: now - RESERVATION_TTL_MS } })
                    .toArray();
                held[h.key] = live.reduce((sum, d) => sum + (Number(d.amount) || 0), 0);
            }
            await check(held);
        } catch (ex) {
            await release();
            throw ex;
        }
        return release;
    }

    private async get_row_collection(account, file_id) {
        return await this._collections.get_dg_collection('data_grid_row', account.id, file_id);
    }

    private async get_col_collection(account, file_id) {
        return await this._collections.get_dg_collection('data_grid_column', account.id, file_id);
    }

    private async get_row_count(account, file_id) {
        // Each table has its own row collection, so its size is the row count: read from the
        // collection's metadata rather than by scanning it on every write (#182)
        const row_c = await this.get_row_collection(account, file_id);
        return await row_c.estimatedDocumentCount();
    }

    /** The account's tables (not folders, not deleted). */
    private async tables(account) {
        return await this.file_directory_repository.findBy({
            account_id: account.id,
            type: 'file',
            deleted: false
        });
    }

    /** Rows per table of the account's tables, from each collection's metadata. */
    async table_row_counts(account): Promise<{ file_id: number; rows: number }[]> {
        const tables = await this.tables(account);
        if (tables.length === 0) return [];
        const db = await this._collections.get_mongo_db(this._collections.get_db_name(account.id));
        return await Promise.all(
            tables.map(async t => {
                const name = `${this._collections.get_dg_collection_name('data_grid_row', t.id)}:acct_${account.id}`;
                // A collection that doesn't exist yet counts 0
                const rows = await db.collection(name).estimatedDocumentCount();
                return { file_id: t.id, rows };
            })
        );
    }

    /** Each table's name, rows and (live) columns, for `GET /usage`. */
    async table_usage(account) {
        const tables = await this.tables(account);
        if (tables.length === 0) return [];
        const db = await this._collections.get_mongo_db(this._collections.get_db_name(account.id));
        const name = (type: string, id: number) =>
            `${this._collections.get_dg_collection_name(type, id)}:acct_${account.id}`;
        return await Promise.all(
            tables.map(async t => ({
                id: t.id,
                name: t.name,
                rows: await db.collection(name('data_grid_row', t.id)).estimatedDocumentCount(),
                columns: await db
                    .collection(name('data_grid_column', t.id))
                    .countDocuments({ deleted: { $in: [null, false] } })
            }))
        );
    }

    /** Rows in all the account's tables together, leaving out `except_file_id`. */
    async account_row_count(account, except_file_id?: number) {
        const counts = await this.table_row_counts(account);
        return counts
            .filter(c => except_file_id === undefined || c.file_id !== Number(except_file_id))
            .reduce((sum, c) => sum + c.rows, 0);
    }

    /** The account's storage in bytes (its Mongo database's `dataSize`), cached briefly. */
    async storage_bytes(account, fresh = false) {
        const now = this.now();
        const cached = this.storage_cache.get(account.id);
        if (!fresh && cached && now - cached.at < STORAGE_CACHE_MS) return cached.bytes;
        const db = await this._collections.get_mongo_db(this._collections.get_db_name(account.id));
        const stats = await db.stats();
        const bytes = Number(stats && stats.dataSize) || 0;
        this.storage_cache.set(account.id, { bytes, at: now });
        return bytes;
    }

    /**
     * 403 `plan_limit` when `adding` more bytes would take the account past its storage cap.
     * A write let through is added to the cached figure, so a burst of writes can't all pass
     * on one stale reading.
     */
    async check_storage(account, adding = 0, plan?: AccountPlan) {
        plan = plan || (await this.plan(account));
        const cap = plan.caps.storage_bytes;
        if (!Number.isFinite(cap)) return;
        const bytes = await this.storage_bytes(account);
        if (bytes + Math.max(0, adding) > cap) {
            throw plan_limit_error('storage_bytes', cap, plan.plan);
        }
        const cached = this.storage_cache.get(account.id);
        if (cached) cached.bytes += Math.max(0, adding);
    }

    private async update_row_count(account, file_id, row_count) {
        const tracking_rc_c = await this.get_tracking_row_count_collection(account);
        await tracking_rc_c.updateOne({ file_id }, { $set: { row_count } }, { upsert: true });
    }

    private async unlock_table(file_id) {
        const data = {
            locked: false,
            locked_reason: null
        };
        await this.file_directory_repository.update({ id: file_id }, data);
    }

    private async lock_table(file_id, locked_reason) {
        const data = {
            locked: true,
            locked_reason
        };
        await this.file_directory_repository.update({ id: file_id }, data);
    }

    // A table under its plan's rows-per-table cap is unlocked. One over it is locked only on a
    // plan change (`may_lock`): deleting rows never locks a table, since a table locked at the
    // cap would refuse reads too (writes are refused at the cap anyway; the read-only state of
    // an account over its caps is #184).
    private async update_table_lock(account, file_id, row_count, may_lock = false) {
        try {
            await this.check_table_rows(account, row_count);
            await this.unlock_table(file_id);
        } catch (ex) {
            if (ex.status === HttpStatus.FORBIDDEN) {
                if (may_lock) await this.lock_table(file_id, ex.message);
            } else {
                throw ex;
            }
        }
    }

    private async validate_table_count(account, tables_to_be_added = 0, plan?: AccountPlan) {
        plan = plan || (await this.plan(account));
        const cap = plan.caps.tables;
        if (!Number.isFinite(cap)) return;

        let table_count = await this.file_directory_repository.countBy({
            account_id: account.id,
            type: 'file',
            deleted: false
        });

        table_count += tables_to_be_added;

        if (table_count > cap) {
            throw plan_limit_error('tables', cap, plan.plan);
        }
    }

    // Like update_table_lock: lifts the table-limit lock under the cap; locks only on a plan
    // change (`may_lock`), never because a table was deleted
    public async update_account_lock(account, may_lock = true) {
        const query = { id: account.id };
        let over = false;
        try {
            await this.validate_table_count(account);
        } catch (ex) {
            if (ex.status !== HttpStatus.FORBIDDEN) throw ex;
            over = true;
        }
        // The saved lock, not the request's copy of the account, which may be stale
        const current = await this.account_repository.findOneBy(query);
        if (!current) return;
        const change = account_lock_change(!!current.locked, current.locked_reason, over);
        if (change === 'lock' && may_lock) {
            await this.account_repository.update(query, {
                locked: true,
                locked_reason: TABLE_LOCK_REASON
            });
        } else if (change === 'unlock') {
            await this.account_repository.update(query, {
                locked: false,
                locked_reason: null
            });
        }
    }

    public async update_account_table_locks(account) {
        const tables = await this.file_directory_repository.findBy({
            account_id: account.id,
            deleted: false
        });
        for (const table of tables) {
            try {
                const row_count = await this.get_row_count(account, table.id);
                await this.update_table_lock(account, table.id, row_count, true);
            } catch (ex) {
                console.error(ex);
            }
        }
    }

    /**
     * Counts an `/api/v1` call (#183): first the account's per-second rate limit (a token
     * bucket in memory; there is one API process), then this UTC month's quota with one atomic
     * `$inc` that only passes under the cap, so parallel calls can't pass it together. Either
     * answers 429 with `Retry-After`; the quota's lasts until the 1st (UTC). A call refused by
     * the rate limit isn't counted. The app's own routes never come here.
     */
    public async update_req_count(account) {
        const plan = await this.plan(account);
        const { caps } = plan;
        if (Number.isFinite(caps.api_rate_per_second) && Number.isFinite(caps.api_rate_burst)) {
            const taken = this.rate_limiter.take(account.id, {
                per_second: caps.api_rate_per_second,
                burst: caps.api_rate_burst
            });
            if ('retry_after_s' in taken) {
                const err = plan_limit_error(
                    'api_rate_per_second',
                    caps.api_rate_per_second,
                    plan.plan,
                    HttpStatus.TOO_MANY_REQUESTS
                );
                throw new HttpException(
                    { ...(err.getResponse() as object), retry_after: taken.retry_after_s },
                    HttpStatus.TOO_MANY_REQUESTS
                );
            }
        }

        const now = this.now();
        const month = quota_month(now);
        const cap = caps.api_calls_per_month;
        const c = await this.get_api_month_collection(account);
        const under = Number.isFinite(cap) ? { count: { $lt: cap } } : {};
        let doc;
        try {
            doc = await c.findOneAndUpdate(
                { _id: month as any, ...under },
                { $inc: { count: 1 } },
                { upsert: true, returnDocument: 'after' }
            );
        } catch (ex) {
            // 11000 = duplicate key: the month's document exists and is at the cap (the upsert
            // tried to make another), or a parallel call made it first. Try once more without
            // the upsert: no match means the cap is reached.
            if (ex.code !== 11000) throw ex;
            doc = await c.findOneAndUpdate(
                { _id: month as any, ...under },
                { $inc: { count: 1 } },
                { returnDocument: 'after' }
            );
        }
        if (!doc) {
            const err = plan_limit_error(
                'api_calls_per_month',
                cap,
                plan.plan,
                HttpStatus.TOO_MANY_REQUESTS
            );
            throw new HttpException(
                { ...(err.getResponse() as object), retry_after: seconds_to_next_month(now) },
                HttpStatus.TOO_MANY_REQUESTS
            );
        }

        // The 80% and 100% emails (#274): only when the count reaches a level not yet marked
        // on the month's document, and never awaited by the call
        const level = plan.internal ? null : quota_level_to_send(doc.count, cap, doc.alerts);
        if (level) {
            const p: Promise<void> = this.send_quota_alert(account, plan, month, cap, level)
                .catch(ex => console.error(`Quota email not sent: ${ex.message}`))
                .finally(() => this.quota_alerts.delete(p));
            this.quota_alerts.add(p);
        }
    }

    /**
     * Marks `level` (and the ones under it) as sent on the month's document in one atomic
     * update that only matches while `level` isn't marked, so of parallel calls one sends it.
     */
    private async send_quota_alert(
        account,
        plan: AccountPlan,
        month: string,
        cap: number,
        level: QuotaLevel
    ) {
        const c = await this.get_api_month_collection(account);
        const res = await c.updateOne(
            { _id: month as any, alerts: { $ne: level } },
            { $addToSet: { alerts: { $each: quota_levels_up_to(level) } } }
        );
        if (!res || res.modifiedCount !== 1) return;
        let email = account.email;
        if (email === undefined && this.account_repository) {
            const saved = await this.account_repository.findOneBy({ id: account.id });
            email = saved && saved.email;
        }
        if (!email || !this.email_manager) return;
        const { subject, body } = api_quota_tmpl(env.HORIZON_FE_PUB_HTTP_URL, {
            level,
            plan_name: plan.plan.name,
            cap,
            month
        });
        this.email_manager.send_html(email, subject, body);
    }

    /** Waits for the quota emails under way (tests). */
    async quota_alerts_settled() {
        await Promise.all([...this.quota_alerts]);
    }

    /** The account's `/api/v1` calls this UTC month. */
    async api_calls_this_month(account) {
        const c = await this.get_api_month_collection(account);
        const doc = await c.findOne({ _id: quota_month(this.now()) as any });
        return Number(doc && doc.count) || 0;
    }

    /** 403 `plan_limit` when a table would hold more rows than the plan allows per table. */
    public async check_table_rows(account, total_rows, plan?: AccountPlan) {
        plan = plan || (await this.plan(account));
        const cap = plan.caps.rows_per_table;
        if (Number.isFinite(cap) && total_rows > cap) {
            throw plan_limit_error('rows_per_table', cap, plan.plan);
        }
    }

    /** 403 `plan_limit` when the account would hold more rows than its plan allows. */
    public async check_account_rows(account, total_rows, plan?: AccountPlan) {
        plan = plan || (await this.plan(account));
        const cap = plan.caps.rows_per_account;
        if (Number.isFinite(cap) && total_rows > cap) {
            throw plan_limit_error('rows_per_account', cap, plan.plan);
        }
    }

    /**
     * A bulk write that sets table `file_id`'s row count to `total_rows` (a CSV upload, a URL
     * import or re-sync): 403 `plan_limit` past the rows-per-table cap, or when the account's
     * other tables plus these would pass the rows-per-account cap.
     */
    public async validate_row_count(account, total_rows, file_id?) {
        const plan = await this.plan(account);
        await this.check_table_rows(account, total_rows, plan);
        if (!Number.isFinite(plan.caps.rows_per_account)) return;
        const others =
            file_id === undefined || file_id === null
                ? await this.account_row_count(account)
                : await this.account_row_count(account, Number(file_id));
        await this.check_account_rows(account, others + total_rows, plan);
    }

    public async validate_column_count(account, file_id, cols_to_be_added) {
        const plan = await this.plan(account);
        const cap = Math.min(plan.caps.columns_per_table, MAX_COLUMNS);
        const col_c = await this.get_col_collection(account, file_id);
        // The collection holds this table's columns only (a column made through batch create
        // needn't carry `file_directory_id`)
        const curr_col_count = await col_c.countDocuments({ deleted: { $in: [null, false] } });
        const total = cols_to_be_added + curr_col_count;
        if (total > cap) {
            throw plan_limit_error('columns_per_table', cap, plan.plan);
        }
    }

    public async check_table_lock(file_id) {
        const file_directory = await this.file_directory_repository.findOneBy({ id: file_id });
        if (file_directory && file_directory.locked) {
            const msg = file_directory.locked_reason || 'File is locked';
            throw new HttpException(msg, HttpStatus.FORBIDDEN);
        }
    }

    public async check_account_lock(account) {
        if (account.locked) {
            const msg = `Account locked: ${account.locked_reason}` || 'Account is locked';
            throw new HttpException(msg, HttpStatus.FORBIDDEN);
        }
    }

    public async deleted_rows(account, data) {
        const file_id = parseInt(data.file_id, 10);
        const new_row_count = await this.get_row_count(account, file_id);
        await this.update_row_count(account, file_id, new_row_count);
        await this.update_table_lock(account, file_id, new_row_count);
        // Deletes free storage; read it again next time
        this.storage_cache.delete(account.id);
    }

    // Recounts a table's rows after a bulk change (a URL re-sync, #144) and locks or unlocks it
    public async refresh_row_count(account, file_id) {
        await this.deleted_rows(account, { file_id });
    }

    /**
     * Reserves room for `rows_to_be_added` rows, or answers 403 `plan_limit` when they'd take
     * the table past its rows-per-table cap, the account past its rows-per-account cap, or the
     * account past its storage cap (`bytes`: their estimated size). Answers the release: await
     * it once the rows are written (or not).
     */
    public async add_rows(account, data): Promise<() => Promise<void>> {
        const file_id = parseInt(data.file_id, 10);
        const rows_to_be_added = Number(data.rows_to_be_added) || 0;
        const plan = await this.plan(account);
        const holds: Hold[] = [{ key: `rows:${file_id}`, amount: rows_to_be_added }];
        const account_capped = Number.isFinite(plan.caps.rows_per_account);
        if (account_capped) holds.push({ key: 'rows:account', amount: rows_to_be_added });
        return await this.reserve(account, holds, async held => {
            const saved = await this.get_row_count(account, file_id);
            await this.check_table_rows(account, saved + held[`rows:${file_id}`], plan);
            if (account_capped) {
                const all = await this.account_row_count(account);
                await this.check_account_rows(account, all + held['rows:account'], plan);
            }
            if (rows_to_be_added > 0) {
                await this.check_storage(account, Number(data.bytes) || 0, plan);
            }
        });
    }

    // A column update adds a column when it turns a deleted one back on: new columns start as
    // deleted placeholders (`get_new_column`) that the grid's batch update switches on. Updates
    // to columns that are already on (renames, widths, order) add nothing.
    private async count_columns_to_be_added(account, file_id, columns: any[]) {
        const ids = [
            ...new Set(
                (columns || [])
                    .filter(c => c && 'deleted' in c && c.deleted !== true)
                    .map(c => String(c._id))
                    .filter(id => ObjectId.isValid(id))
            )
        ];
        if (ids.length === 0) return 0;
        const col_c = await this.get_col_collection(account, file_id);
        return await col_c.countDocuments({
            _id: { $in: ids.map(id => new ObjectId(id)) },
            deleted: true
        });
    }

    public async add_columns(account, data) {
        const file_id = parseInt(data.file_id, 10);
        const cols_to_be_added = await this.count_columns_to_be_added(
            account,
            file_id,
            data.columns
        );
        if (cols_to_be_added === 0) return;
        await this.validate_column_count(account, file_id, cols_to_be_added);
    }

    /** Columns made by a batch create: each one that isn't deleted is a new column. */
    public async create_columns(account, data) {
        const file_id = parseInt(data.file_id, 10);
        const columns = Array.isArray(data.columns) ? data.columns : [];
        const cols_to_be_added = columns.filter(c => c && c.deleted !== true).length;
        if (cols_to_be_added === 0) return;
        await this.validate_column_count(account, file_id, cols_to_be_added);
    }

    /**
     * Reserves a table, or answers 403 `plan_limit` when one more would pass the plan's table
     * cap. Answers the release: await it once the table is saved (or not).
     */
    public async add_table(account): Promise<() => Promise<void>> {
        const plan = await this.plan(account);
        return await this.reserve(account, [{ key: 'tables', amount: 1 }], async held => {
            await this.validate_table_count(account, held.tables, plan);
        });
    }

    public async deleted_table(account) {
        await this.update_account_lock(account, false);
        this.storage_cache.delete(account.id);
    }
}
