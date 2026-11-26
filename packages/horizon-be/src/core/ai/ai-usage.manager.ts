import { Injectable } from '@nestjs/common';
import { MongoDbCollections } from '../mongodb/collections';

const USAGE = 'tracking:ai_usage';
const SERVER = 'tracking:ai_server_usage';

export interface AiUsage {
    month: string;
    questions: number;
    // Generated rows (#148)
    rows: number;
    input_tokens: number;
    output_tokens: number;
    // What the month's AI use cost, in micro-dollars
    cost_micros: number;
}

const EMPTY = { questions: 0, rows: 0, input_tokens: 0, output_tokens: 0, cost_micros: 0 };

// The month's cost is under the budget (an older document may have no cost yet)
const under_budget = (budget_micros: number) => ({
    $or: [{ cost_micros: { $exists: false } }, { cost_micros: { $lt: budget_micros } }]
});

// AI usage per account and month (#149), in one collection of the tracking database shared by
// all accounts: one document per account and UTC month. Every read and write filters on
// account_id. The whole server's cost per month is in a second collection, for the
// server-wide budget (docs/PRICING.md 3.5).
@Injectable()
export class AiUsageManager {
    private indexed = false;
    private server_indexed = false;

    constructor(private _collections: MongoDbCollections) {}

    private async collection() {
        const usage = await this._collections.get_shared_tracking_collection(USAGE);
        if (!this.indexed) {
            await usage.createIndex({ account_id: 1, month: 1 }, { unique: true });
            this.indexed = true;
        }
        return usage;
    }

    private async server_collection() {
        const usage = await this._collections.get_shared_tracking_collection(SERVER);
        if (!this.server_indexed) {
            await usage.createIndex({ month: 1 }, { unique: true });
            this.server_indexed = true;
        }
        return usage;
    }

    async get(account_id: number, month: string): Promise<AiUsage> {
        const empty = { month, ...EMPTY };
        if (!account_id) return empty;
        const usage = await this.collection();
        const doc = await usage.findOne({ account_id, month });
        if (!doc) return empty;
        return {
            month,
            questions: doc.questions || 0,
            rows: doc.rows || 0,
            input_tokens: doc.input_tokens || 0,
            output_tokens: doc.output_tokens || 0,
            cost_micros: doc.cost_micros || 0
        };
    }

    /**
     * Counts one question if the month's count is under `limit` and its cost is under
     * `budget_micros`, in one atomic update, so questions asked at the same time can't go over
     * the count. False when either is reached.
     */
    async reserve(
        account_id: number,
        month: string,
        limit: number,
        budget_micros: number
    ): Promise<boolean> {
        if (!account_id || !(limit > 0) || !(budget_micros > 0)) return false;
        const usage = await this.ensure(account_id, month);
        const res = await usage.updateOne(
            { account_id, month, questions: { $lt: limit }, ...under_budget(budget_micros) },
            { $inc: { questions: 1 } }
        );
        return res.modifiedCount === 1;
    }

    /**
     * Takes `rows` generated rows of the month's `allowance` if they fit and the cost is under
     * `budget_micros`, in one atomic update. False (and nothing taken) otherwise.
     */
    async reserve_rows(
        account_id: number,
        month: string,
        rows: number,
        allowance: number,
        budget_micros: number
    ): Promise<boolean> {
        if (!account_id || !(rows > 0) || !(rows <= allowance) || !(budget_micros > 0)) {
            return false;
        }
        const usage = await this.ensure(account_id, month);
        const res = await usage.updateOne(
            {
                account_id,
                month,
                $and: [
                    {
                        $or: [{ rows: { $exists: false } }, { rows: { $lte: allowance - rows } }]
                    },
                    under_budget(budget_micros)
                ]
            },
            { $inc: { rows } }
        );
        return res.modifiedCount === 1;
    }

    /** Hands back generated rows reserved but never asked of the model. */
    async release_rows(account_id: number, month: string, rows: number) {
        if (!account_id || !(rows > 0)) return;
        const usage = await this.collection();
        await usage.updateOne({ account_id, month }, { $inc: { rows: -rows } });
    }

    // The account's document for the month, made if missing
    private async ensure(account_id: number, month: string) {
        const usage = await this.collection();
        try {
            await usage.updateOne(
                { account_id, month },
                { $setOnInsert: { ...EMPTY } },
                { upsert: true }
            );
        } catch (ex) {
            // Another request made the document first
            if (ex.code !== 11000) throw ex;
        }
        return usage;
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

    /** Adds what a question used to the account's month. */
    async add_usage(
        account_id: number,
        month: string,
        input_tokens: number,
        output_tokens: number,
        cost_micros: number
    ) {
        if (!account_id) return;
        const usage = await this.collection();
        await usage.updateOne(
            { account_id, month },
            {
                $inc: {
                    input_tokens: input_tokens || 0,
                    output_tokens: output_tokens || 0,
                    cost_micros: cost_micros || 0
                }
            }
        );
    }

    /**
     * The admin area (#277) only: each account's cost in the month, in micro-dollars. The one
     * read across accounts.
     */
    async month_costs(month: string): Promise<Map<number, number>> {
        const usage = await this.collection();
        const docs = await usage
            .find({ month }, { projection: { account_id: 1, cost_micros: 1 } })
            .toArray();
        const out = new Map<number, number>();
        docs.forEach(d => out.set(Number(d.account_id), Number(d.cost_micros) || 0));
        return out;
    }

    /** What every account's AI use cost this month, in micro-dollars. */
    async server_cost(month: string): Promise<number> {
        const usage = await this.server_collection();
        const doc = await usage.findOne({ month });
        return (doc && doc.cost_micros) || 0;
    }

    /** Adds to the server's month; returns its cost before and after. */
    async add_server_cost(month: string, cost_micros: number) {
        const usage = await this.server_collection();
        const doc = await usage.findOneAndUpdate(
            { month },
            { $inc: { cost_micros: cost_micros || 0 } },
            { upsert: true, returnDocument: 'after' }
        );
        const after = (doc && doc.cost_micros) || 0;
        return { before: after - (cost_micros || 0), after };
    }
}
