import { Injectable } from '@nestjs/common';
import { MongoDbCollections } from '../mongodb/collections';

const USAGE = 'tracking:ai_usage';

export interface AiUsage {
    account_id: number;
    /** `2026-11` (UTC) */
    month: string;
    /** Generated rows this month */
    rows: number;
    requests: number;
}

// Each account's AI usage per month (#148): one document per account and month, in one
// collection of the tracking database shared by all accounts, so every read and write filters
// on account_id. Rows are reserved before the model is called and the unused part handed back,
// so two requests at once can't pass the allowance together.
@Injectable()
export class AiUsageManager {
    private indexed = false;

    constructor(private _collections: MongoDbCollections) {}

    private async collection() {
        const usage = await this._collections.get_shared_tracking_collection(USAGE);
        if (!this.indexed) {
            await usage.createIndex({ account_id: 1, month: 1 }, { unique: true });
            this.indexed = true;
        }
        return usage;
    }

    /** Rows the account generated in the month. */
    async used(account_id: number, month: string): Promise<number> {
        if (!account_id || !month) return 0;
        const usage = await this.collection();
        const doc = await usage.findOne({ account_id, month });
        return (doc && doc.rows) || 0;
    }

    /** Takes `rows` of the account's allowance; false (and nothing taken) if they don't fit. */
    async reserve(account_id: number, month: string, rows: number, allowance: number) {
        if (!account_id || !month || rows <= 0) return false;
        const usage = await this.collection();
        try {
            await usage.updateOne(
                { account_id, month },
                { $setOnInsert: { rows: 0, requests: 0 } },
                { upsert: true }
            );
        } catch (ex) {
            // Another request made the document first
            if (!ex || ex.code !== 11000) throw ex;
        }
        const res = await usage.updateOne(
            { account_id, month, rows: { $lte: allowance - rows } },
            { $inc: { rows, requests: 1 }, $set: { updated_at: Date.now() } }
        );
        return res.modifiedCount === 1;
    }

    /** Hands back rows reserved but not generated. */
    async release(account_id: number, month: string, rows: number) {
        if (!account_id || !month || rows <= 0) return;
        const usage = await this.collection();
        await usage.updateOne({ account_id, month }, { $inc: { rows: -rows } });
    }
}
