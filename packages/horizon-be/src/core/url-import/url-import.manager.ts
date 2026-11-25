import { Injectable } from '@nestjs/common';
import { MongoDbCollections } from '../mongodb/collections';
import { SourceKind, SyncMode, SyncSchedule } from './url-import';

const COLLECTION = 'tracking:url_source';

// Where an imported table's rows come from (#144), and how its last fetch went
export interface UrlSource {
    file_id: number;
    account_id: number;
    url: string;
    fetch_url: string;
    kind: SourceKind;
    mode: SyncMode;
    key_column: string | null;
    schedule: SyncSchedule;
    created_at: number;
    next_sync_at: number | null;
    last_synced_at: number | null;
    last_status: 'PENDING' | 'OK' | 'ERROR' | null;
    last_error: string | null;
    last_row_count: number | null;
}

// One document per imported table, in a collection of the tracking database shared by all
// accounts, so the scheduler can find the due ones with one query. Every read and write here
// filters on account_id as well as file_id.
@Injectable()
export class UrlImportManager {
    private indexed = false;

    constructor(private _collections: MongoDbCollections) {}

    private async collection() {
        const c = await this._collections.get_shared_tracking_collection(COLLECTION);
        if (!this.indexed) {
            await c.createIndex({ account_id: 1, file_id: 1 }, { unique: true });
            await c.createIndex({ next_sync_at: 1 });
            this.indexed = true;
        }
        return c;
    }

    async get(account_id: number, file_id: number): Promise<UrlSource | null> {
        if (!account_id || !file_id) return null;
        const c = await this.collection();
        const doc = await c.findOne({ account_id, file_id }, { projection: { _id: 0 } });
        return (doc as unknown as UrlSource) || null;
    }

    async create(source: UrlSource) {
        const c = await this.collection();
        await c.replaceOne(
            { account_id: source.account_id, file_id: source.file_id },
            { ...source },
            { upsert: true }
        );
        return source;
    }

    async update(account_id: number, file_id: number, changes: Partial<UrlSource>) {
        if (!account_id || !file_id) return null;
        const c = await this.collection();
        const { account_id: _a, file_id: _f, ...rest } = changes as any;
        await c.updateOne({ account_id, file_id }, { $set: rest });
        return await this.get(account_id, file_id);
    }

    async remove(account_id: number, file_id: number) {
        if (!account_id || !file_id) return;
        const c = await this.collection();
        await c.deleteOne({ account_id, file_id });
    }

    /** Sources whose scheduled sync is due, oldest first. */
    async due(now: number, limit = 20): Promise<UrlSource[]> {
        const c = await this.collection();
        const docs = await c
            .find(
                { schedule: { $ne: 'off' }, next_sync_at: { $ne: null, $lte: now } },
                { projection: { _id: 0 } }
            )
            .sort({ next_sync_at: 1 })
            .limit(limit)
            .toArray();
        return docs as unknown as UrlSource[];
    }
}
