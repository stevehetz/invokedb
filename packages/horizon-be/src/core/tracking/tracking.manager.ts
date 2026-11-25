import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MongoDbCollections } from '../mongodb/collections';
import { Repository } from 'typeorm';
import { ObjectId } from 'mongodb';
import { Account } from '../account/account.entity';
import { FileDirectory } from '../file-directory/file-directory.entity';
import { Subscription } from '../subscription/subscription.entity';
import env from '@app/env';

const EXCEPTIONS = {
    TABLE_LIMIT_EXCEEDED: 'Table limit exceeded for current subscription',
    ROW_COUNT_EXCEEDED: 'Row count limit exceeded for current subscription',
    COL_COUNT_EXCEEDED: 'Column count limit exceeded for current subscription',
    REQ_COUNT_EXCEEDED: 'External API request limit exceeded for current subscription'
};

export const MAX_COLUMNS = 52;

// `/api/v1` calls are counted in fixed one-minute windows (#182)
export const REQUEST_WINDOW_MS = 60 * 1000;
// The Free plan's limit, for a plan with none: a missing limit must not mean unlimited (#182)
export const DEFAULT_MAX_REQUESTS_PER_MINUTE = 50;

// How long a reservation holds tables or rows if the write that made it never releases it
// (the process died mid-write). Writes release theirs as soon as they finish.
export const RESERVATION_TTL_MS = 10 * 60 * 1000;

/** The window `now` falls in, and the seconds until the next one starts (for `Retry-After`). */
export function request_window(now: number) {
    const start = Math.floor(now / REQUEST_WINDOW_MS) * REQUEST_WINDOW_MS;
    const retry_after_s = Math.max(1, Math.ceil((start + REQUEST_WINDOW_MS - now) / 1000));
    return { start, retry_after_s };
}

/** A plan's requests per minute; a missing or non-positive limit falls back to Free's. */
export function requests_per_minute(limit: unknown) {
    const n = Number(limit);
    return limit !== null && limit !== undefined && Number.isFinite(n) && n > 0
        ? n
        : DEFAULT_MAX_REQUESTS_PER_MINUTE;
}

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
    if (locked && locked_reason === EXCEPTIONS.TABLE_LIMIT_EXCEEDED) return 'unlock';
    return null;
}

@Injectable()
export class TrackingManager {
    constructor(
        private _collections: MongoDbCollections,
        @InjectRepository(Account)
        private readonly account_repository: Repository<Account>,
        @InjectRepository(Subscription)
        private readonly subscription_repository: Repository<Subscription>,
        @InjectRepository(FileDirectory)
        private readonly file_directory_repository: Repository<FileDirectory>
    ) {}

    // The clock, replaceable in tests
    now: () => number = () => Date.now();

    async get_tracking_limits_collection(account) {
        return await this._collections.get_collection(account.id, 'tracking:limits', {
            db_name: env.HORIZON_MONGO_TRACKING_DB,
            mongo_uri: env.HORIZON_MONGO_TRACKING_URI
        });
    }

    async get_tracking_row_count_collection(account) {
        return await this._collections.get_collection(account.id, 'tracking:row_count', {
            db_name: env.HORIZON_MONGO_TRACKING_DB,
            mongo_uri: env.HORIZON_MONGO_TRACKING_URI
        });
    }

    async get_tracking_request_count_collection(account) {
        return await this._collections.get_collection(account.id, 'tracking:req_count', {
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
     * Holds `amount` of a limit (tables, or one table's rows) while a write runs, so parallel
     * writes can't pass the cap together (#182). The hold is written first, then `check` gets
     * the sum of every live hold on the key, its own included, to add to the saved count. Of
     * two racing writes, the later hold sees the earlier one, or (once that is released) its
     * saved rows, so near the cap both may be refused but never both let through. Answers the
     * release, which the caller awaits once its write has finished or failed.
     */
    private async reserve(
        account,
        key: string,
        amount: number,
        check: (held: number) => Promise<void>
    ): Promise<() => Promise<void>> {
        const c = await this.get_tracking_reservation_collection(account);
        const now = this.now();
        await c.deleteMany({ at: { $lte: now - RESERVATION_TTL_MS } });
        const { insertedId } = await c.insertOne({ key, amount, at: now });
        let released = false;
        const release = async () => {
            if (released) return;
            released = true;
            try {
                await c.deleteOne({ _id: insertedId });
            } catch (ex) {
                // Never fails the write it follows: a hold left behind expires on its own
                console.error(`Reservation ${key} not released: ${ex.message}`);
            }
        };
        try {
            const holds = await c.find({ key, at: { $gt: now - RESERVATION_TTL_MS } }).toArray();
            const held = holds.reduce((sum, h) => sum + (Number(h.amount) || 0), 0);
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

    private async get_subscription(account) {
        if (account.subscription_id) {
            return await this.subscription_repository.findOneBy({
                id: account.subscription_id
            });
        } else {
            return await this.subscription_repository.findOneBy({
                id: 'SUB_FREE'
            });
        }
    }

    private async get_limits(account) {
        const collection = await this.get_tracking_limits_collection(account);
        const limits = await collection.findOne();

        if (limits) return limits;

        return await this.update_limits(account);
    }

    private async get_row_count(account, file_id) {
        // Each table has its own row collection, so its size is the row count: read from the
        // collection's metadata rather than by scanning it on every write (#182)
        const row_c = await this.get_row_collection(account, file_id);
        return await row_c.estimatedDocumentCount();
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

    private async update_table_lock(account, file_id, row_count) {
        try {
            await this.validate_row_count(account, row_count);
            await this.unlock_table(file_id);
        } catch (ex) {
            if (ex.status === HttpStatus.FORBIDDEN) {
                await this.lock_table(file_id, ex.message);
            } else {
                throw ex;
            }
        }
    }

    private async validate_table_count(account, tables_to_be_added = 0) {
        const limits = await this.get_limits(account);

        let table_count = await this.file_directory_repository.countBy({
            account_id: account.id,
            type: 'file',
            deleted: false
        });

        table_count += tables_to_be_added;

        if (table_count > limits.max_tables) {
            throw new HttpException(EXCEPTIONS.TABLE_LIMIT_EXCEEDED, HttpStatus.FORBIDDEN);
        }
    }

    public async update_limits(account) {
        const subscription = await this.get_subscription(account);
        const collection = await this.get_tracking_limits_collection(account);
        const curr_limits = await collection.findOne();
        const new_limits = {
            max_tables: subscription.max_tables,
            max_rows: subscription.max_rows,
            max_requests_per_minute: subscription.max_requests_per_minute
        };
        if (curr_limits) {
            await collection.updateOne({ _id: curr_limits._id }, { $set: new_limits });
        } else {
            await collection.insertOne(new_limits);
        }
        return new_limits;
    }

    public async update_account_lock(account) {
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
        if (change === 'lock') {
            await this.account_repository.update(query, {
                locked: true,
                locked_reason: EXCEPTIONS.TABLE_LIMIT_EXCEEDED
            });
        } else if (change === 'unlock') {
            await this.account_repository.update(query, {
                locked: false,
                locked_reason: null
            });
        }
    }

    public async update_account_table_locks(account) {
        const limits = await this.get_limits(account);
        const tables = await this.file_directory_repository.findBy({
            account_id: account.id,
            deleted: false
        });
        for (const table of tables) {
            try {
                const row_count = await this.get_row_count(account, table.id);
                await this.validate_row_count(account, row_count, limits);
                await this.unlock_table(table.id);
            } catch (ex) {
                if (ex.status === 403) {
                    await this.lock_table(table.id, ex.message);
                } else {
                    console.error(ex);
                }
            }
        }
    }

    // Counts an `/api/v1` call in this minute's window with one atomic `$inc`, so parallel calls
    // are all counted, and answers 429 with `Retry-After` past the plan's limit (#182). The
    // window's document has the window's start as its `_id`.
    public async update_req_count(account) {
        const limits = await this.get_limits(account);
        const max = requests_per_minute(limits.max_requests_per_minute);
        const { start, retry_after_s } = request_window(this.now());
        const c = await this.get_tracking_request_count_collection(account);
        const count_call = () =>
            c.findOneAndUpdate(
                { _id: start as any },
                { $inc: { count: 1 } },
                { upsert: true, returnDocument: 'after' }
            );
        let doc;
        try {
            doc = await count_call();
        } catch (ex) {
            // 11000 = duplicate key: a parallel call made this window's document first
            if (ex.code !== 11000) throw ex;
            doc = await count_call();
        }
        // The first call of a window drops the earlier ones (and the old single document)
        if (doc && doc.count === 1) await c.deleteMany({ _id: { $ne: start as any } });
        if (doc && doc.count > max) {
            throw new HttpException(
                { message: EXCEPTIONS.REQ_COUNT_EXCEEDED, retry_after: retry_after_s },
                HttpStatus.TOO_MANY_REQUESTS
            );
        }
    }

    public async validate_row_count(account, total_rows, limits?) {
        limits = limits || (await this.get_limits(account));
        if (total_rows > limits.max_rows) {
            throw new HttpException(EXCEPTIONS.ROW_COUNT_EXCEEDED, HttpStatus.FORBIDDEN);
        }
    }

    public async validate_column_count(account, file_id, cols_to_be_added) {
        const col_c = await this.get_col_collection(account, file_id);
        // The collection holds this table's columns only (a column made through batch create
        // needn't carry `file_directory_id`)
        const curr_col_count = await col_c.countDocuments({ deleted: { $in: [null, false] } });
        const total = cols_to_be_added + curr_col_count;
        if (total > MAX_COLUMNS) {
            throw new HttpException(EXCEPTIONS.COL_COUNT_EXCEEDED, HttpStatus.FORBIDDEN);
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
    }

    // Recounts a table's rows after a bulk change (a URL re-sync, #144) and locks or unlocks it
    public async refresh_row_count(account, file_id) {
        await this.deleted_rows(account, { file_id });
    }

    /**
     * Reserves room for `rows_to_be_added` rows, or answers 403 when they'd take the table past
     * its row limit. Answers the release: await it once the rows are written (or not).
     */
    public async add_rows(account, data): Promise<() => Promise<void>> {
        const file_id = parseInt(data.file_id, 10);
        const rows_to_be_added = Number(data.rows_to_be_added) || 0;
        const limits = await this.get_limits(account);
        return await this.reserve(account, `rows:${file_id}`, rows_to_be_added, async held => {
            const saved = await this.get_row_count(account, file_id);
            await this.validate_row_count(account, saved + held, limits);
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
     * Reserves a table, or answers 403 when one more would pass the plan's table limit. Answers
     * the release: await it once the table is saved (or not).
     */
    public async add_table(account): Promise<() => Promise<void>> {
        return await this.reserve(account, 'tables', 1, async held => {
            await this.validate_table_count(account, held);
        });
    }

    public async deleted_table(account) {
        await this.update_account_lock(account);
    }
}
