import { Injectable } from '@nestjs/common';
import { MongoDbCollections } from '../mongodb/collections';
import {
    ALERT_EVERY_MS,
    ErrorEvent,
    ErrorListQuery,
    KEEP_DAYS,
    MAX_FINGERPRINTS,
    fingerprint
} from './error-tracking';

const ERRORS = 'tracking:error';
// The fingerprint count is read again at most this often (the cap on new ones)
const COUNT_EVERY_MS = 60 * 1000;

export interface ErrorGroup {
    id: string;
    source: string;
    message: string;
    top_frame: string | null;
    count: number;
    first_seen: number | null;
    last_seen: number | null;
    route: string | null;
    status: number | null;
    account_id: number | null;
    page: string | null;
    kind: string | null;
}

const time = (d: any): number | null => {
    if (!d) return null;
    const t = new Date(d).getTime();
    return Number.isFinite(t) ? t : null;
};

const group_of = (doc: any): ErrorGroup => ({
    id: doc._id,
    source: doc.source,
    message: doc.message,
    top_frame: doc.top_frame ?? null,
    count: Number(doc.count) || 0,
    first_seen: time(doc.first_seen),
    last_seen: time(doc.last_seen),
    route: doc.route ?? null,
    status: doc.status ?? null,
    account_id: doc.account_id ?? null,
    page: doc.page ?? null,
    kind: doc.kind ?? null
});

// The errors (#212): one document per fingerprint in the tracking DB (shared, not per account:
// account_id is only the last account it happened to), with its count, first and last time seen
// and the latest occurrence's details. A TTL index on last_seen drops an error KEEP_DAYS after
// it was last seen.
@Injectable()
export class ErrorTrackingManager {
    private indexed = false;
    private counted: { at: number; count: number } | null = null;

    constructor(private _collections: MongoDbCollections) {}

    private async collection() {
        const c = await this._collections.get_shared_tracking_collection(ERRORS);
        if (!this.indexed) {
            await c.createIndex(
                { last_seen: 1 },
                { expireAfterSeconds: KEEP_DAYS * 24 * 60 * 60, name: 'last_seen_ttl' }
            );
            await c.createIndex({ source: 1, last_seen: -1 });
            this.indexed = true;
        }
        return c;
    }

    private async room_for_new(c: any, now: number) {
        if (!this.counted || now - this.counted.at > COUNT_EVERY_MS) {
            this.counted = { at: now, count: await c.estimatedDocumentCount() };
        }
        return this.counted.count < MAX_FINGERPRINTS;
    }

    /**
     * Counts an occurrence. `is_new` when the fingerprint wasn't stored before (or was dropped);
     * `stored` false when it was new but the cap on fingerprints is reached.
     */
    async record(
        event: ErrorEvent,
        now: number
    ): Promise<{ id: string; is_new: boolean; stored: boolean }> {
        const c = await this.collection();
        const id = fingerprint(event.source, event.message, event.top_frame);
        const at = new Date(now);
        const update = {
            $setOnInsert: { source: event.source, first_seen: at },
            $set: {
                message: event.message,
                top_frame: event.top_frame,
                stack: event.stack,
                route: event.route,
                status: event.status,
                account_id: event.account_id,
                page: event.page,
                user_agent: event.user_agent,
                kind: event.kind,
                last_seen: at
            },
            $inc: { count: 1 }
        };
        const upsert = await this.room_for_new(c, now);
        let before;
        try {
            before = await c.findOneAndUpdate({ _id: id } as any, update, {
                upsert,
                returnDocument: 'before'
            });
        } catch (ex) {
            // 11000 = duplicate key: another process stored it first, so it's no longer new
            if (ex.code !== 11000) throw ex;
            await c.updateOne({ _id: id } as any, update);
            return { id, is_new: false, stored: true };
        }
        if (before) return { id, is_new: false, stored: true };
        if (this.counted) this.counted.count++;
        return { id, is_new: true, stored: upsert };
    }

    /** Claims the fingerprint's alert: true at most once per ALERT_EVERY_MS, across processes. */
    async claim_alert(id: string, now: number): Promise<boolean> {
        const c = await this.collection();
        const res = await c.updateOne(
            {
                _id: id,
                $or: [
                    { alerted_at: { $exists: false } },
                    { alerted_at: { $lte: new Date(now - ALERT_EVERY_MS) } }
                ]
            } as any,
            { $set: { alerted_at: new Date(now) } }
        );
        return res.modifiedCount === 1;
    }

    /** The admin list, last seen first (no stacks). */
    async list(q: ErrorListQuery) {
        const c = await this.collection();
        const filter: any = q.source ? { source: q.source } : {};
        const [docs, total] = await Promise.all([
            c
                .find(filter, { projection: { stack: 0, user_agent: 0 } })
                .sort({ last_seen: -1 })
                .skip((q.page - 1) * q.limit)
                .limit(q.limit)
                .toArray(),
            c.countDocuments(filter)
        ]);
        return { errors: docs.map(group_of), total, page: q.page, limit: q.limit };
    }

    /** One error with its latest stack, or null. */
    async get(id: string) {
        if (typeof id !== 'string' || !/^[0-9a-f]{24}$/.test(id)) return null;
        const c = await this.collection();
        const doc = await c.findOne({ _id: id } as any);
        if (!doc) return null;
        return { ...group_of(doc), stack: doc.stack ?? null, user_agent: doc.user_agent ?? null };
    }
}
