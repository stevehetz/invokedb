import { Injectable } from '@nestjs/common';
import { MongoDbCollections } from '../mongodb/collections';
import { AI_COLUMN_LIMITS, AiColumnSettings, StopReason } from './ai-column';

const COLUMNS = 'tracking:ai_column';

// How long a processor holds a column it's filling before another may take it over
const LEASE_MS = 10 * 60 * 1000;

export type AiColumnState = 'idle' | 'filling' | 'done' | 'stopped';

/** An AI column (#205) of a table, as stored. */
export interface AiColumn extends AiColumnSettings {
    account_id: number;
    file_id: number;
    /** On once the owner confirmed a fill: later row changes are computed by themselves */
    auto: boolean;
    /** settings_hash() of the settings the owner confirmed */
    filled_hash: string | null;
    state: AiColumnState;
    stopped_reason: StopReason | null;
    /** Cells computed by the model, all time */
    computed: number;
    created_at: number;
    updated_at: number;
    filled_at: number | null;
    // The processor's queue: work to do, the rows changed since (or the whole table)
    pending?: boolean;
    full?: boolean;
    dirty_ids?: string[];
    lease_until?: number;
    turn_at?: number;
    // The work a run took (claim), kept until the run is over (release), so a run whose
    // processor stopped is taken again with it once its lease is over
    claimed?: boolean;
    claimed_full?: boolean;
    claimed_ids?: string[];
}

const PUBLIC = {
    _id: 0,
    pending: 0,
    full: 0,
    dirty_ids: 0,
    lease_until: 0,
    turn_at: 0,
    claimed: 0,
    claimed_full: 0,
    claimed_ids: 0
};

/**
 * The update claim() makes: the waiting work (`full`, `dirty_ids`) joins the work a run that
 * never ended left (`claimed_*`, only when `claimed`) into the run's fields, and the queue is
 * emptied. Past max_dirty_ids the run looks at the whole table, as rows_changed() does.
 */
export function claim_pipeline(lease_until: number, now: number) {
    const was_claimed = { $eq: ['$claimed', true] };
    return [
        {
            $set: {
                _prev_full: { $cond: [was_claimed, { $eq: ['$claimed_full', true] }, false] },
                _prev_ids: { $cond: [was_claimed, { $ifNull: ['$claimed_ids', []] }, []] }
            }
        },
        {
            $set: {
                claimed_full: { $or: ['$_prev_full', { $eq: ['$full', true] }] },
                claimed_ids: { $setUnion: ['$_prev_ids', { $ifNull: ['$dirty_ids', []] }] }
            }
        },
        {
            $set: {
                claimed_full: {
                    $or: [
                        '$claimed_full',
                        { $gt: [{ $size: '$claimed_ids' }, AI_COLUMN_LIMITS.max_dirty_ids] }
                    ]
                }
            }
        },
        {
            $set: {
                claimed_ids: { $cond: ['$claimed_full', [], '$claimed_ids'] },
                claimed: true,
                pending: false,
                full: false,
                dirty_ids: [],
                lease_until,
                turn_at: now
            }
        },
        { $unset: ['_prev_full', '_prev_ids'] }
    ];
}

// The AI columns of every account, in one collection of the tracking database shared by all
// accounts: one document per table and column. Every read and write filters on account_id, but
// the processor's claim of the next column to fill. The cells' values are in the table's rows.
@Injectable()
export class AiColumnManager {
    private indexed = false;

    constructor(private _collections: MongoDbCollections) {}

    private async collection() {
        const cols = await this._collections.get_shared_tracking_collection(COLUMNS);
        if (!this.indexed) {
            await cols.createIndex({ account_id: 1, file_id: 1, field: 1 }, { unique: true });
            await cols.createIndex({ pending: 1 });
            await cols.createIndex({ claimed: 1 });
            this.indexed = true;
        }
        return cols;
    }

    /** A table's AI columns. */
    async list(account_id: number, file_id: number): Promise<AiColumn[]> {
        if (!account_id || !file_id) return [];
        const cols = await this.collection();
        const docs = await cols
            .find({ account_id, file_id }, { projection: PUBLIC })
            .sort({ created_at: 1 })
            .toArray();
        return docs as unknown as AiColumn[];
    }

    async get(account_id: number, file_id: number, field: string): Promise<AiColumn | null> {
        if (!account_id || !file_id || typeof field !== 'string') return null;
        const cols = await this.collection();
        const doc = await cols.findOne({ account_id, file_id, field }, { projection: PUBLIC });
        return (doc as unknown as AiColumn) || null;
    }

    /**
     * Saves a column's settings. Changed settings turn `auto` off: the column is filled again
     * only when the owner confirms it.
     */
    async save(account_id: number, file_id: number, settings: AiColumnSettings, now: number) {
        const cols = await this.collection();
        const before = await this.get(account_id, file_id, settings.field);
        const same =
            !!before &&
            before.prompt === settings.prompt &&
            JSON.stringify(before.inputs) === JSON.stringify(settings.inputs);
        if (before) {
            await cols.updateOne(
                { account_id, file_id, field: settings.field },
                {
                    $set: {
                        prompt: settings.prompt,
                        inputs: settings.inputs,
                        updated_at: now,
                        ...(same ? {} : { auto: false, state: 'idle', stopped_reason: null })
                    }
                }
            );
        } else {
            const doc: AiColumn = {
                account_id,
                file_id,
                field: settings.field,
                prompt: settings.prompt,
                inputs: settings.inputs,
                auto: false,
                filled_hash: null,
                state: 'idle',
                stopped_reason: null,
                computed: 0,
                created_at: now,
                updated_at: now,
                filled_at: null
            };
            await cols.insertOne(doc);
        }
        return await this.get(account_id, file_id, settings.field);
    }

    async remove(account_id: number, file_id: number, field: string) {
        if (!account_id || !file_id || typeof field !== 'string') return false;
        const cols = await this.collection();
        const res = await cols.deleteOne({ account_id, file_id, field });
        return res.deletedCount === 1;
    }

    /** Every AI column of a table, when the table is gone. */
    async remove_table(account_id: number, file_id: number) {
        if (!account_id || !file_id) return;
        const cols = await this.collection();
        await cols.deleteMany({ account_id, file_id });
    }

    /** The owner confirmed filling the column: every out-of-date row is computed. */
    async fill(account_id: number, file_id: number, field: string, hash: string, now: number) {
        const cols = await this.collection();
        await cols.updateOne(
            { account_id, file_id, field },
            {
                $set: {
                    auto: true,
                    filled_hash: hash,
                    state: 'filling',
                    stopped_reason: null,
                    filled_at: now,
                    pending: true,
                    full: true,
                    dirty_ids: []
                }
            }
        );
    }

    /**
     * A column whose cells were written with their hashes already (the demo's showcase, #333):
     * filled, nothing waiting. Later row changes are computed as after any fill.
     */
    async mark_filled(
        account_id: number,
        file_id: number,
        field: string,
        hash: string,
        computed: number,
        now: number
    ) {
        const cols = await this.collection();
        await cols.updateOne(
            { account_id, file_id, field },
            {
                $set: {
                    auto: true,
                    filled_hash: hash,
                    state: 'done',
                    stopped_reason: null,
                    filled_at: now,
                    computed,
                    pending: false,
                    full: false,
                    dirty_ids: []
                }
            }
        );
    }

    /**
     * Rows of a table changed (made or updated in the app, the API, a form or an AI edit):
     * its filling AI columns look at them. Past max_dirty_ids the whole table is looked at.
     */
    async rows_changed(account_id: number, file_id: number, ids: string[]) {
        if (!account_id || !file_id) return;
        const cols = await this.collection();
        const filter = { account_id, file_id: Number(file_id), auto: true };
        const list = (Array.isArray(ids) ? ids : []).map(String).filter(Boolean);
        if (list.length === 0 || list.length > AI_COLUMN_LIMITS.max_dirty_ids) {
            await cols.updateMany(filter, { $set: { pending: true, full: true, dirty_ids: [] } });
            return;
        }
        await cols.updateMany(filter, {
            $set: { pending: true },
            $addToSet: { dirty_ids: { $each: list } }
        });
        await cols.updateMany(
            { ...filter, [`dirty_ids.${AI_COLUMN_LIMITS.max_dirty_ids}`]: { $exists: true } },
            { $set: { full: true, dirty_ids: [] } }
        );
    }

    /**
     * The processor takes the next column with work waiting, of any account (the one read
     * across accounts), and holds it for a while. The waiting work moves into the run's own
     * fields (`claimed_full`, `claimed_ids`), so changes made meanwhile wait for the next turn,
     * and stays stored until release(): a column whose run never ended (its processor stopped)
     * is taken again, with that work, once the lease is over. The column whose last turn is
     * oldest (or never was) goes first, so a big column doesn't keep the others waiting.
     * Answers the column with the run's work as `full` and `dirty_ids`, or null.
     */
    async claim(now: number): Promise<AiColumn | null> {
        const cols = await this.collection();
        const doc = await cols.findOneAndUpdate(
            {
                $and: [
                    { $or: [{ pending: true }, { claimed: true }] },
                    { $or: [{ lease_until: { $exists: false } }, { lease_until: { $lt: now } }] }
                ]
            },
            claim_pipeline(now + LEASE_MS, now),
            { returnDocument: 'after', sort: { turn_at: 1 } }
        );
        if (!doc) return null;
        const col = doc as unknown as AiColumn;
        return {
            ...col,
            full: !!col.claimed_full,
            dirty_ids: Array.isArray(col.claimed_ids) ? col.claimed_ids.map(String) : []
        };
    }

    /**
     * A run is over. `more`: there's work left (the run's cap was reached), so the column is
     * taken again on a later turn and the whole table looked at. `keep`: the run did nothing
     * (the account or table was locked), so the work it claimed is put back for a later turn.
     */
    async release(
        col: AiColumn,
        changes: Partial<Pick<AiColumn, 'state' | 'stopped_reason' | 'auto'>>,
        computed: number,
        more: boolean,
        keep = false
    ) {
        const cols = await this.collection();
        const filter = { account_id: col.account_id, file_id: col.file_id, field: col.field };
        await cols.updateOne(filter, {
            $set: { ...changes, ...(more ? { pending: true, full: true } : {}) },
            $unset: { lease_until: '', claimed: '', claimed_full: '', claimed_ids: '' },
            $inc: { computed: computed || 0 }
        });
        if (!keep || more) return;
        const ids = Array.isArray(col.dirty_ids) ? col.dirty_ids : [];
        if (col.full) {
            await cols.updateOne(filter, { $set: { pending: true, full: true, dirty_ids: [] } });
            return;
        }
        if (ids.length === 0) return;
        await cols.updateOne(filter, {
            $set: { pending: true },
            $addToSet: { dirty_ids: { $each: ids } }
        });
        await cols.updateOne(
            { ...filter, [`dirty_ids.${AI_COLUMN_LIMITS.max_dirty_ids}`]: { $exists: true } },
            { $set: { full: true, dirty_ids: [] } }
        );
    }
}
