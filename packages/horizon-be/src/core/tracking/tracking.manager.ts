import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MongoDbCollections } from '../mongodb/collections';
import { Repository } from 'typeorm';
import { Account } from '../account/account.entity';
import { FileDirectory } from '../file-directory/file-directory.entity';
import { get_plan, PlanLimits, usage_month } from '../billing/plans';
import env from '@app/env';

const EXCEPTIONS = {
    TABLE_LIMIT_EXCEEDED: 'Table limit reached for your plan',
    ROW_COUNT_EXCEEDED: 'Row limit reached for your plan',
    COL_COUNT_EXCEEDED: 'Column count limit exceeded',
    REQ_COUNT_EXCEEDED: 'Monthly API call limit reached for your plan'
};

export interface Usage {
    plan: string;
    plan_status: string | null;
    limits: PlanLimits;
    tables: number;
    // Rows in the account's biggest table (the row cap is per table)
    max_table_rows: number;
    api_calls_this_month: number;
    read_only: boolean;
    read_only_reason: string | null;
}

// Enforces the account's plan caps (core/billing/plans.ts). An account over its table cap is
// locked and a table over its row cap is locked: both turn read-only (writes are refused, reads
// and deletes still work, so the owner can get back under the caps or upgrade).
@Injectable()
export class TrackingManager {
    constructor(
        private _collections: MongoDbCollections,
        @InjectRepository(Account)
        private readonly account_repository: Repository<Account>,
        @InjectRepository(FileDirectory)
        private readonly file_directory_repository: Repository<FileDirectory>
    ) {}

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

    private async get_row_collection(account, file_id) {
        return await this._collections.get_dg_collection('data_grid_row', account.id, file_id);
    }

    private async get_col_collection(account, file_id) {
        return await this._collections.get_dg_collection('data_grid_column', account.id, file_id);
    }

    // The caps come from the account's plan; nothing is cached, so a plan change applies at once
    private get_limits(account): PlanLimits {
        return get_plan(account.plan).limits;
    }

    private async get_row_count(account, file_id) {
        const row_c = await this.get_row_collection(account, file_id);
        return await row_c.countDocuments();
    }

    private async update_row_count(account, file_id, row_count) {
        const tracking_rc_c = await this.get_tracking_row_count_collection(account);
        await tracking_rc_c.updateOne({ file_id }, { $set: { row_count } }, { upsert: true });
    }

    private async validate_add_row_count(account, file_id, rows_to_be_added) {
        const current_row_count = await this.get_row_count(account, file_id);
        const new_row_count = current_row_count + rows_to_be_added;

        await this.validate_row_count(account, new_row_count);

        return new_row_count;
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

    private async count_tables(account) {
        return await this.file_directory_repository.countBy({
            account_id: account.id,
            type: 'file',
            deleted: false
        });
    }

    private async validate_table_count(account, tables_to_be_added = 0) {
        const limits = this.get_limits(account);
        const table_count = (await this.count_tables(account)) + tables_to_be_added;

        if (table_count > limits.max_tables) {
            throw new HttpException(EXCEPTIONS.TABLE_LIMIT_EXCEEDED, HttpStatus.FORBIDDEN);
        }
    }

    // After a plan change: lock the account if it's over its table cap and each table over its
    // row cap, and unlock whatever is back under them
    public async on_plan_change(account) {
        await this.update_account_lock(account);
        await this.update_account_table_locks(account);
    }

    public async update_account_lock(account) {
        const query = { id: account.id };
        try {
            await this.validate_table_count(account);
            await this.account_repository.update(query, {
                locked: false,
                locked_reason: null
            });
        } catch (ex) {
            if (ex.status === HttpStatus.FORBIDDEN) {
                await this.account_repository.update(query, {
                    locked: true,
                    locked_reason: ex.message
                });
            } else {
                throw ex;
            }
        }
    }

    public async update_account_table_locks(account) {
        const limits = this.get_limits(account);
        const tables = await this.file_directory_repository.findBy({
            account_id: account.id,
            type: 'file',
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

    // Counts one external API call against this month's cap; past it the call is refused (429)
    public async update_req_count(account) {
        const limits = this.get_limits(account);
        const req_count_c = await this.get_tracking_request_count_collection(account);
        const doc = await req_count_c.findOneAndUpdate(
            { month: usage_month() },
            { $inc: { count: 1 } },
            { upsert: true, returnDocument: 'after' }
        );
        if ((doc?.count ?? 1) > limits.max_api_calls_per_month) {
            throw new HttpException(EXCEPTIONS.REQ_COUNT_EXCEEDED, HttpStatus.TOO_MANY_REQUESTS);
        }
    }

    private async get_api_calls_this_month(account) {
        const req_count_c = await this.get_tracking_request_count_collection(account);
        const doc = await req_count_c.findOne({ month: usage_month() });
        // Refused calls are counted too; show at most the cap
        return Math.min(doc?.count ?? 0, this.get_limits(account).max_api_calls_per_month);
    }

    public async get_usage(account): Promise<Usage> {
        const tables = await this.file_directory_repository.findBy({
            account_id: account.id,
            type: 'file',
            deleted: false
        });
        let max_table_rows = 0;
        for (const table of tables) {
            max_table_rows = Math.max(max_table_rows, await this.get_row_count(account, table.id));
        }
        return {
            plan: get_plan(account.plan).id,
            plan_status: account.plan_status ?? null,
            limits: this.get_limits(account),
            tables: tables.length,
            max_table_rows,
            api_calls_this_month: await this.get_api_calls_this_month(account),
            read_only: !!account.locked,
            read_only_reason: account.locked ? account.locked_reason : null
        };
    }

    public async validate_row_count(account, total_rows, limits?) {
        limits = limits || this.get_limits(account);
        if (total_rows > limits.max_rows) {
            throw new HttpException(EXCEPTIONS.ROW_COUNT_EXCEEDED, HttpStatus.FORBIDDEN);
        }
    }

    public async validate_column_count(account, file_id, cols_to_be_added) {
        const col_c = await this.get_col_collection(account, file_id);
        const curr_col_count = await col_c.countDocuments({
            file_directory_id: file_id,
            deleted: { $in: [null, false] }
        });
        const total = cols_to_be_added + curr_col_count;
        if (total > 52) {
            throw new HttpException(EXCEPTIONS.COL_COUNT_EXCEEDED, HttpStatus.FORBIDDEN);
        }
    }

    // Refuses a write to a read-only (locked) table
    public async check_table_lock(file_id) {
        const file_directory = await this.file_directory_repository.findOneBy({ id: file_id });
        if (file_directory && file_directory.locked) {
            const reason = file_directory.locked_reason || 'over your plan limits';
            const msg = `Table is read-only: ${reason}. Delete rows or upgrade.`;
            throw new HttpException(msg, HttpStatus.FORBIDDEN);
        }
    }

    // Refuses a write to a read-only (locked) account
    public async check_account_lock(account) {
        if (account.locked) {
            const reason = account.locked_reason || 'over your plan limits';
            const msg = `Account is read-only: ${reason}. Delete tables or upgrade.`;
            throw new HttpException(msg, HttpStatus.FORBIDDEN);
        }
    }

    public async deleted_rows(account, data) {
        const file_id = parseInt(data.file_id, 10);
        const new_row_count = await this.get_row_count(account, file_id);
        await this.update_row_count(account, file_id, new_row_count);
        await this.update_table_lock(account, file_id, new_row_count);
    }

    public async add_rows(account, data) {
        const file_id = parseInt(data.file_id, 10);
        const rows_to_be_added = data.rows_to_be_added;
        const new_row_count = await this.validate_add_row_count(account, file_id, rows_to_be_added);
        await this.update_row_count(account, file_id, new_row_count);
    }

    public async add_columns(account, data) {
        const file_id = parseInt(data.file_id, 10);
        const cols_to_be_added = data.cols_to_be_added;
        this.validate_column_count(account, file_id, cols_to_be_added);
    }

    public async add_table(account) {
        await this.check_account_lock(account);
        const tables_to_be_added = 1;
        await this.validate_table_count(account, tables_to_be_added);
    }

    public async deleted_table(account) {
        await this.update_account_lock(account);
    }
}
