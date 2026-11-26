import { Injectable } from '@nestjs/common';
import { MongoDbCollections } from '../mongodb/collections';
import { AuditEntry, AuditPage } from './audit';

const ENTRIES = 'tracking:audit';

// The audit log (#217): one collection in the tracking database shared by all accounts. Every
// read filters on account_id, except the processor's prune of old entries.
@Injectable()
export class AuditManager {
    private indexed = false;

    constructor(private _collections: MongoDbCollections) {}

    private async entries() {
        const coll = await this._collections.get_shared_tracking_collection(ENTRIES);
        if (!this.indexed) {
            await coll.createIndex({ account_id: 1, created_at: -1, id: -1 });
            await coll.createIndex({ account_id: 1, file_id: 1, created_at: -1, id: -1 });
            await coll.createIndex({ created_at: 1 });
            this.indexed = true;
        }
        return coll;
    }

    async add(list: AuditEntry[]) {
        if (list.length === 0) return;
        const coll = await this.entries();
        await coll.insertMany(list.map(e => ({ ...e })));
    }

    /**
     * One page of an account's entries, newest first; with `file_id`, only that table's. Reads
     * one more than `limit`, so the caller knows whether there's another page.
     */
    async page(account_id: number, file_id: number | null, page: AuditPage) {
        if (!account_id) return [];
        const coll = await this.entries();
        const filter: any = { account_id };
        if (file_id) filter.file_id = file_id;
        if (page.before) {
            filter.$or = [
                { created_at: { $lt: page.before.at } },
                { created_at: page.before.at, id: { $lt: page.before.id } }
            ];
        }
        const docs = await coll
            .find(filter, { projection: { _id: 0 } })
            .sort({ created_at: -1, id: -1 })
            .limit(page.limit + 1)
            .toArray();
        return docs as unknown as AuditEntry[];
    }

    /**
     * Deletes the entries made before `cutoff` of every account but `except_account_ids` (which
     * keep theirs longer, #183); answers how many.
     */
    async prune(cutoff: number, except_account_ids: number[] = []) {
        const coll = await this.entries();
        const filter: any = { created_at: { $lt: cutoff } };
        if (except_account_ids.length > 0) filter.account_id = { $nin: except_account_ids };
        const res = await coll.deleteMany(filter);
        return res.deletedCount || 0;
    }
}
