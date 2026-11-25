import { Injectable } from '@nestjs/common';
import { MongoDbCollections } from '../mongodb/collections';

const USAGE = 'tracking:ai_usage';

export interface AiUsage {
    month: string;
    questions: number;
    input_tokens: number;
    output_tokens: number;
}

// AI usage per account and month (#149), in one collection of the tracking database shared by
// all accounts: one document per account and UTC month. Every read and write filters on
// account_id.
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

    async get(account_id: number, month: string): Promise<AiUsage> {
        const empty = { month, questions: 0, input_tokens: 0, output_tokens: 0 };
        if (!account_id) return empty;
        const usage = await this.collection();
        const doc = await usage.findOne({ account_id, month });
        if (!doc) return empty;
        return {
            month,
            questions: doc.questions || 0,
            input_tokens: doc.input_tokens || 0,
            output_tokens: doc.output_tokens || 0
        };
    }

    /**
     * Counts one question if the month's count is under `limit`, in one atomic update, so
     * questions asked at the same time can't go over it. False when the limit is reached.
     */
    async reserve(account_id: number, month: string, limit: number): Promise<boolean> {
        if (!account_id || !(limit > 0)) return false;
        const usage = await this.collection();
        try {
            await usage.updateOne(
                { account_id, month },
                { $setOnInsert: { questions: 0, input_tokens: 0, output_tokens: 0 } },
                { upsert: true }
            );
        } catch (ex) {
            // Another request made the document first
            if (ex.code !== 11000) throw ex;
        }
        const res = await usage.updateOne(
            { account_id, month, questions: { $lt: limit } },
            { $inc: { questions: 1 } }
        );
        return res.modifiedCount === 1;
    }

    /** Gives back a question that the model never answered. */
    async release(account_id: number, month: string) {
        if (!account_id) return;
        const usage = await this.collection();
        await usage.updateOne(
            { account_id, month, questions: { $gt: 0 } },
            { $inc: { questions: -1 } }
        );
    }

    async add_tokens(
        account_id: number,
        month: string,
        input_tokens: number,
        output_tokens: number
    ) {
        if (!account_id) return;
        const usage = await this.collection();
        await usage.updateOne(
            { account_id, month },
            { $inc: { input_tokens: input_tokens || 0, output_tokens: output_tokens || 0 } }
        );
    }
}
