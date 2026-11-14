import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MongoDbCollections } from '../mongodb/collections';
import { Repository } from 'typeorm';
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

    private async get_row_collection(account, file_id) {
        return await this._collections.get_dg_collection('data_grid_row', account.id, file_id);
    }

    private async get_col_collection(account, file_id) {
        return await this._collections.get_dg_collection('data_grid_column', account.id, file_id);
    }

    private async get_subscription(account) {
        if (account.subscription_id) {
            return await this.subscription_repository.findOne({
                id: account.subscription_id
            });
        } else {
            return await this.subscription_repository.findOne({
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
        const row_c = await this.get_row_collection(account, file_id);
        return await row_c.find().count();
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

    private async validate_table_count(account, tables_to_be_added = 0) {
        const limits = await this.get_limits(account);

        let table_count = await this.file_directory_repository.count({
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
        const limits = await this.get_limits(account);
        const tables = await this.file_directory_repository.find({
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

    public async update_req_count(account) {
        const limits = await this.get_limits(account);

        if (!limits.max_requests_per_minute) {
            return;
        }

        const now = new Date();
        const req_count_c = await this.get_tracking_request_count_collection(account);
        const req_count_obj = await req_count_c.findOne();

        if (req_count_obj) {
            const req_time_limit_min = 0.2;
            const { start_time, count } = req_count_obj;
            const diff_ms = now.getTime() - start_time;
            const diff_min = diff_ms / 60000;
            if (diff_min >= req_time_limit_min) {
                // Over time limit
                await req_count_c.updateOne(
                    { start_time },
                    { $set: { count: 1, start_time: now.getTime() } }
                );
            } else {
                if (count + 1 > limits.max_requests_per_minute)
                    // Over req_count limit
                    throw new HttpException(EXCEPTIONS.REQ_COUNT_EXCEEDED, HttpStatus.FORBIDDEN);

                // Within time limit, within req_count limit
                await req_count_c.updateOne({ start_time }, { $set: { count: count + 1 } });
            }
        } else {
            await req_count_c.insertOne({
                start_time: now.getTime(),
                count: 1
            });
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
        const curr_col_count = await col_c
            .find({
                file_directory_id: file_id,
                deleted: { $in: [null, false] }
            })
            .count();
        const total = cols_to_be_added + curr_col_count;
        if (total > 52) {
            throw new HttpException(EXCEPTIONS.COL_COUNT_EXCEEDED, HttpStatus.FORBIDDEN);
        }
    }

    public async check_table_lock(file_id) {
        const file_directory = await this.file_directory_repository.findOne({ id: file_id });
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
        const tables_to_be_added = 1;
        await this.validate_table_count(account, tables_to_be_added);
    }

    public async deleted_table(account) {
        await this.update_account_lock(account);
    }
}
