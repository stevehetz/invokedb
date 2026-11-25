import { Injectable } from '@nestjs/common';
import { Db, MongoClient } from 'mongodb';
import env from '@app/env';

@Injectable()
export class MongoDbCollections {
    connections: { [db_name: string]: Db } = {};
    clients: { [uri: string]: Promise<MongoClient> } = {};

    constructor() {}

    get_db_name(acct_id) {
        return `${env.HORIZON_MONGO_DB}:acct_${acct_id}`;
    }

    async get_mongo_db(db_name, mongo_uri?) {
        mongo_uri = mongo_uri || env.HORIZON_MONGO_URI;
        if (!this.connections[db_name]) {
            // One client (connection pool) per URI, shared by every database on it
            if (!this.clients[mongo_uri]) {
                this.clients[mongo_uri] = MongoClient.connect(mongo_uri).catch(err => {
                    delete this.clients[mongo_uri]; // let the next call retry
                    throw err;
                });
            }
            const client = await this.clients[mongo_uri];
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
        if (!exists) {
            try {
                await db.createCollection(name);
            } catch (err) {
                // 48 = NamespaceExists: a concurrent request created it first
                if (err.code !== 48) throw err;
            }
        }
        return db.collection(name);
    }

    // A collection shared by every account in the tracking database (no `:acct_<id>` suffix),
    // such as `tracking:url_source` (#144). Every query on it must filter on account_id.
    async get_shared_tracking_collection(name: string) {
        const db = await this.get_mongo_db(
            env.HORIZON_MONGO_TRACKING_DB,
            env.HORIZON_MONGO_TRACKING_URI
        );
        return db.collection(name);
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
