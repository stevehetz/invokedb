import { Injectable } from '@nestjs/common';
import { MongoClient } from 'mongodb';
import env from '@app/env';
import logger from '@app/logger';

const mongo_backup = require('mongodb-backup-4x');
const mongo_restore = require('mongodb-restore');

@Injectable()
export class MongoDbCollections {
    connections = {};

    constructor() {}

    async backup_dg_row_collection(acct_id, file_id) {
        const uri = `${env.HORIZON_MONGO_URI}/horizonacct_${acct_id}`;
        const collection = `dg:row:file_${file_id}:acct_${acct_id}`;
        await mongo_backup({
            uri,
            root: `${env.HORIZON_FILE_SHARE}/temp`,
            collections: [collection],
            callback: err => {
                if (err) {
                    logger.error(err);
                }
            }
        });
    }

    async restore_dg_row_collection(acct_id, file_id) {
        const uri = `${env.HORIZON_MONGO_URI}/horizonacct_3`;
        const collection = `dg:row:file_${file_id}:acct_${acct_id}`;
        await mongo_restore({
            uri,
            root: `${env.HORIZON_FILE_SHARE}/temp/horizonacct_${acct_id}`,
            collections: [collection],
            dropCollections: [collection],
            callback: err => {
                if (err) {
                    console.log('here');
                    logger.error(err);
                }
            }
        });
    }

    get_db_name(acct_id) {
        return `${env.HORIZON_MONGO_DB}:acct_${acct_id}`;
    }

    async get_mongo_db(db_name, mongo_uri?) {
        mongo_uri = mongo_uri || env.HORIZON_MONGO_URI;
        if (!this.connections[db_name]) {
            const client = await MongoClient.connect(mongo_uri, {
                useNewUrlParser: true,
                useUnifiedTopology: true
            });
            this.connections[db_name] = client.db(db_name);
        }

        return this.connections[db_name];
    }

    async collection_exists(name, db) {
        const res = await db.listCollections({ name }).next();
        return !!res;
    }

    async get_collection(acct_id, collection, opts: any = {}) {
        const db_name = opts.db_name || this.get_db_name(acct_id);
        const db = await this.get_mongo_db(db_name, opts.mongo_uri);
        const name = `${collection}:acct_${acct_id}`;
        const exists = await this.collection_exists(name, db);
        if (exists) {
            return await db.collection(name);
        } else {
            return await db.createCollection(name);
        }
    }

    async get_dg_row(acct_id, file_id) {
        return this.get_dg_collection('data_grid_row', acct_id, file_id);
    }

    async get_dg_col(acct_id, file_id) {
        return this.get_dg_collection('data_grid_column', acct_id, file_id);
    }

    async get_dg_collection(type, acct_id, file_id) {
        const name = this.get_dg_collection_name(type, file_id);
        return await this.get_collection(acct_id, name);
    }

    get_dg_collection_name(type, file_id) {
        type = type.replace('data_grid_', '');
        return `dg:${type}:file_${file_id}`;
    }
}
