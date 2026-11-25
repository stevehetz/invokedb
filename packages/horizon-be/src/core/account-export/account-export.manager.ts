import { Injectable } from '@nestjs/common';
import { MongoDbCollections } from '../mongodb/collections';
import { AccountExport, EXPORT_LIMITS, is_export_id } from './account-export';

const EXPORTS = 'tracking:account_export';

// Data exports (#215), in one collection of the tracking database shared by all accounts, so the
// processor can find expired ones with one query. Every read and write from the app filters on
// account_id as well as the id. The zips themselves are on the file share.
@Injectable()
export class AccountExportManager {
    private indexed = false;

    constructor(private _collections: MongoDbCollections) {}

    private async collection() {
        const exports = await this._collections.get_shared_tracking_collection(EXPORTS);
        if (!this.indexed) {
            await exports.createIndex({ id: 1 }, { unique: true });
            await exports.createIndex({ account_id: 1, created_at: -1 });
            await exports.createIndex({ status: 1, expires_at: 1 });
            await exports.createIndex(
                { created_date: 1 },
                { expireAfterSeconds: EXPORT_LIMITS.keep_record_days * 24 * 3600 }
            );
            this.indexed = true;
        }
        return exports;
    }

    async create(e: AccountExport) {
        const exports = await this.collection();
        await exports.insertOne({ ...e });
        return e;
    }

    async get(account_id: number, id: string): Promise<AccountExport | null> {
        if (!account_id || !is_export_id(id)) return null;
        const exports = await this.collection();
        const doc = await exports.findOne({ account_id, id }, { projection: { _id: 0 } });
        return (doc as unknown as AccountExport) || null;
    }

    /** The account's newest export. */
    async latest(account_id: number): Promise<AccountExport | null> {
        if (!account_id) return null;
        const exports = await this.collection();
        const doc = await exports.findOne(
            { account_id },
            { projection: { _id: 0 }, sort: { created_at: -1 } }
        );
        return (doc as unknown as AccountExport) || null;
    }

    async count_since(account_id: number, since: number) {
        if (!account_id) return 0;
        const exports = await this.collection();
        return await exports.countDocuments({ account_id, created_at: { $gte: since } });
    }

    async update(account_id: number, id: string, changes: Partial<AccountExport>) {
        if (!account_id || !is_export_id(id)) return;
        const exports = await this.collection();
        const { account_id: _a, id: _i, ...rest } = changes as any;
        await exports.updateOne({ account_id, id }, { $set: rest });
    }

    /** Ready exports whose link has stopped working (every account: the processor's cleanup). */
    async expired(now: number): Promise<AccountExport[]> {
        const exports = await this.collection();
        const docs = await exports
            .find({ status: 'ready', expires_at: { $lte: now } }, { projection: { _id: 0 } })
            .limit(100)
            .toArray();
        return docs as unknown as AccountExport[];
    }
}
