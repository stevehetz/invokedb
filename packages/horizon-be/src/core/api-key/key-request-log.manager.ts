import { Injectable } from '@nestjs/common';
import { MongoDbCollections } from '../mongodb/collections';
import { KeyRequest, MAX_LOGGED_REQUESTS } from './key-request-log';

const LOG = 'tracking:api_key_request';

// Each API key's last MAX_LOGGED_REQUESTS requests (#216): one document per key, in a collection
// of the tracking database shared by all accounts, so every read and write filters on
// account_id as well as key_id. `$push` with `$slice` keeps the list capped in one atomic write.
@Injectable()
export class KeyRequestLogManager {
    private indexed = false;

    constructor(private _collections: MongoDbCollections) {}

    private async collection() {
        const c = await this._collections.get_shared_tracking_collection(LOG);
        if (!this.indexed) {
            await c.createIndex({ account_id: 1, key_id: 1 }, { unique: true });
            this.indexed = true;
        }
        return c;
    }

    async record(account_id: number, key_id: number, entry: KeyRequest) {
        if (!account_id || !key_id) return;
        const c = await this.collection();
        const update = {
            $push: { requests: { $each: [entry], $slice: -MAX_LOGGED_REQUESTS } }
        } as any;
        const write = () => c.updateOne({ account_id, key_id }, update, { upsert: true });
        try {
            await write();
        } catch (ex) {
            // 11000 = duplicate key: a parallel request made this key's document first
            if (ex.code !== 11000) throw ex;
            await write();
        }
    }

    /** The key's recent requests, newest first. */
    async list(account_id: number, key_id: number): Promise<KeyRequest[]> {
        if (!account_id || !key_id) return [];
        const c = await this.collection();
        const doc = await c.findOne({ account_id, key_id });
        const requests: KeyRequest[] = Array.isArray(doc?.requests) ? doc.requests : [];
        return requests
            .map(r => ({
                at: r.at,
                method: r.method,
                path: r.path,
                status: r.status,
                duration_ms: r.duration_ms
            }))
            .reverse();
    }

    /** Drops the logs of keys that are gone. */
    async remove(account_id: number, key_ids: number[]) {
        if (!account_id || key_ids.length === 0) return;
        const c = await this.collection();
        await c.deleteMany({ account_id, key_id: { $in: key_ids } });
    }
}
