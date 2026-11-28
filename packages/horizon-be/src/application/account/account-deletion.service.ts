import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import * as fs from 'fs';
import * as path from 'path';
import { MongoDbCollections } from '@app/core/mongodb/collections';
import { export_file_name, is_export_id } from '@app/core/account-export/account-export';
import env from '@app/env';
import logger from '@app/logger';

// The collections of the shared tracking database that hold an account's documents (each
// filtered on `account_id`)
export const SHARED_TRACKING_COLLECTIONS = [
    'tracking:url_source',
    'tracking:webhook',
    'tracking:webhook_delivery',
    'tracking:view',
    'tracking:audit',
    'tracking:ai_usage',
    'tracking:api_key_request',
    'tracking:account_export',
    'tracking:ai_column'
];

// The Postgres tables with an `account_id`, deleted before the account row itself
export const ACCOUNT_TABLES = [
    'session',
    'reset_password',
    'email_verification',
    'account_identity',
    'api_key',
    'two_factor',
    'job',
    'file_directory'
];

/** Whether a tracking database collection is one of account `id`'s own (`...:acct_<id>`). */
export function is_account_collection(name: string, account_id: number) {
    return typeof name === 'string' && name.endsWith(`:acct_${account_id}`);
}

// Deletes an account and all its data (#184): its Mongo database (the tables' rows and columns),
// its collections and documents in the tracking database (onboarding, row counts, the API
// quota, views, webhooks and their deliveries, URL sources, the audit log, AI usage, key
// request logs, exports and their zips, AI column settings) and its Postgres rows, the account last. Each step can
// run again, so a deletion that failed half-way is finished by the next try.
@Injectable()
export class AccountDeletionService {
    constructor(
        private readonly data_source: DataSource,
        private readonly _collections: MongoDbCollections
    ) {}

    async delete_account(account_id: number) {
        if (!Number.isInteger(account_id) || account_id <= 0) {
            throw new Error(`Not an account id: ${account_id}`);
        }

        // The account's own database
        const db = await this._collections.get_mongo_db(this._collections.get_db_name(account_id));
        await db.dropDatabase();

        // Its collections in the tracking database
        const tracking = await this._collections.get_mongo_db(
            env.HORIZON_MONGO_TRACKING_DB,
            env.HORIZON_MONGO_TRACKING_URI
        );
        const names = await tracking.listCollections({}, { nameOnly: true }).toArray();
        for (const { name } of names) {
            if (is_account_collection(name, account_id)) await tracking.collection(name).drop();
        }

        // Its documents in the shared ones; the export zips first, while their records are there
        const export_records =
            await this._collections.get_shared_tracking_collection('tracking:account_export');
        const records = await export_records
            .find({ account_id }, { projection: { id: 1 } })
            .toArray();
        for (const r of records) {
            if (!is_export_id(r.id)) continue;
            const file = path.join(env.HORIZON_FILE_SHARE, 'exports', export_file_name(r.id));
            await fs.promises.rm(file, { force: true });
        }
        for (const name of SHARED_TRACKING_COLLECTIONS) {
            const c = await this._collections.get_shared_tracking_collection(name);
            await c.deleteMany({ account_id });
        }

        // Postgres, in one transaction, the account row last
        await this.data_source.transaction(async m => {
            for (const table of ACCOUNT_TABLES) {
                await m.query(`DELETE FROM ${table} WHERE account_id = $1`, [account_id]);
            }
            await m.query(`DELETE FROM account WHERE id = $1`, [account_id]);
        });
        logger.info(`Account ${account_id} and all its data deleted`);
    }
}
