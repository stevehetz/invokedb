import { Injectable } from '@nestjs/common';
import { MongoDbCollections } from '../mongodb/collections';
import { MAX_ATTEMPTS, TEST_EVENT, WEBHOOK_LIMITS, WebhookEvent } from './webhook';

const WEBHOOKS = 'tracking:webhook';
const DELIVERIES = 'tracking:webhook_delivery';

// A URL an account's apps are told about row changes on (#140)
export interface Webhook {
    id: string;
    account_id: number;
    // null: every table of the account
    file_id: number | null;
    url: string;
    events: WebhookEvent[];
    enabled: boolean;
    secret: string;
    created_at: number;
    last_delivery_at: number | null;
    last_delivery_status: DeliveryStatus | null;
}

export type DeliveryStatus = 'pending' | 'sending' | 'ok' | 'failed';

export interface DeliveryAttempt {
    at: number;
    status: number;
    ms: number;
    error: string | null;
    response: string | null;
}

export interface WebhookDelivery {
    id: string;
    webhook_id: string;
    account_id: number;
    file_id: number | null;
    event: WebhookEvent | typeof TEST_EVENT;
    // The exact JSON sent (it's what the signature covers)
    body: string;
    rows: number;
    status: DeliveryStatus;
    attempts: number;
    attempt_log: DeliveryAttempt[];
    next_attempt_at: number | null;
    // While 'sending': if the sender dies, the delivery is picked up again after this
    lease_until: number | null;
    created_at: number;
    // A Date, for the TTL index that removes old deliveries
    created_date: Date;
    delivered_at: number | null;
}

const SEND_LEASE_MS = 2 * 60 * 1000;

// Webhooks and their deliveries, in two collections of the tracking database shared by all
// accounts, so the processor can find due deliveries with one query. Every read and write
// filters on account_id as well as the id, except the processor's claim of due deliveries.
@Injectable()
export class WebhookManager {
    private indexed = false;

    constructor(private _collections: MongoDbCollections) {}

    private async collections() {
        const hooks = await this._collections.get_shared_tracking_collection(WEBHOOKS);
        const deliveries = await this._collections.get_shared_tracking_collection(DELIVERIES);
        if (!this.indexed) {
            await hooks.createIndex({ id: 1 }, { unique: true });
            await hooks.createIndex({ account_id: 1, file_id: 1 });
            await deliveries.createIndex({ id: 1 }, { unique: true });
            await deliveries.createIndex({ account_id: 1, webhook_id: 1, created_at: -1 });
            await deliveries.createIndex({ status: 1, next_attempt_at: 1 });
            await deliveries.createIndex(
                { created_date: 1 },
                { expireAfterSeconds: WEBHOOK_LIMITS.keep_deliveries_days * 24 * 3600 }
            );
            this.indexed = true;
        }
        return { hooks, deliveries };
    }

    async list(account_id: number): Promise<Webhook[]> {
        if (!account_id) return [];
        const { hooks } = await this.collections();
        const docs = await hooks
            .find({ account_id }, { projection: { _id: 0 } })
            .sort({ created_at: 1 })
            .toArray();
        return docs as unknown as Webhook[];
    }

    async count(account_id: number) {
        if (!account_id) return 0;
        const { hooks } = await this.collections();
        return await hooks.countDocuments({ account_id });
    }

    async get(account_id: number, id: string): Promise<Webhook | null> {
        if (!account_id || typeof id !== 'string' || !id) return null;
        const { hooks } = await this.collections();
        const doc = await hooks.findOne({ account_id, id }, { projection: { _id: 0 } });
        return (doc as unknown as Webhook) || null;
    }

    /** The enabled webhooks of an account that want `event` on table `file_id`. */
    async matching(account_id: number, file_id: number, event: WebhookEvent) {
        if (!account_id || !file_id) return [];
        const { hooks } = await this.collections();
        const docs = await hooks
            .find(
                { account_id, enabled: true, events: event, file_id: { $in: [file_id, null] } },
                { projection: { _id: 0 } }
            )
            .toArray();
        return docs as unknown as Webhook[];
    }

    async create(hook: Webhook) {
        const { hooks } = await this.collections();
        await hooks.insertOne({ ...hook });
        return hook;
    }

    async update(account_id: number, id: string, changes: Partial<Webhook>) {
        if (!account_id || !id) return null;
        const { hooks } = await this.collections();
        const { account_id: _a, id: _i, ...rest } = changes as any;
        await hooks.updateOne({ account_id, id }, { $set: rest });
        return await this.get(account_id, id);
    }

    /** Removes a webhook and its deliveries. */
    async remove(account_id: number, id: string) {
        if (!account_id || !id) return;
        const { hooks, deliveries } = await this.collections();
        await hooks.deleteOne({ account_id, id });
        await deliveries.deleteMany({ account_id, webhook_id: id });
    }

    /** Removes the webhooks of a deleted table, and their deliveries. */
    async remove_for_table(account_id: number, file_id: number) {
        if (!account_id || !file_id) return;
        const { hooks, deliveries } = await this.collections();
        const ids = (await hooks.find({ account_id, file_id }).toArray()).map(h => h.id);
        if (ids.length === 0) return;
        await hooks.deleteMany({ account_id, id: { $in: ids } });
        await deliveries.deleteMany({ account_id, webhook_id: { $in: ids } });
    }

    async add_deliveries(list: WebhookDelivery[]) {
        if (list.length === 0) return;
        const { deliveries } = await this.collections();
        await deliveries.insertMany(list.map(d => ({ ...d })));
    }

    /** A webhook's newest deliveries, for the app's log. */
    async deliveries(account_id: number, webhook_id: string, limit = WEBHOOK_LIMITS.log_size) {
        if (!account_id || !webhook_id) return [];
        const { deliveries } = await this.collections();
        const docs = await deliveries
            .find({ account_id, webhook_id }, { projection: { _id: 0, created_date: 0 } })
            .sort({ created_at: -1 })
            .limit(limit)
            .toArray();
        return docs as unknown as WebhookDelivery[];
    }

    /**
     * Claims the next delivery due to be sent (or one whose sender stopped mid-way), marking it
     * 'sending' so another processor doesn't send it too. Answers null when none is due.
     */
    async claim_due(now: number): Promise<WebhookDelivery | null> {
        const { deliveries } = await this.collections();
        const doc = await deliveries.findOneAndUpdate(
            {
                $or: [
                    { status: 'pending', next_attempt_at: { $lte: now } },
                    { status: 'sending', lease_until: { $lte: now } }
                ]
            },
            { $set: { status: 'sending', lease_until: now + SEND_LEASE_MS } },
            { sort: { next_attempt_at: 1 }, returnDocument: 'after', projection: { _id: 0 } }
        );
        return (doc as unknown as WebhookDelivery) || null;
    }

    /** Records an attempt: delivered, retried at `next_attempt_at`, or failed (null). */
    async attempt_done(
        delivery: WebhookDelivery,
        attempt: DeliveryAttempt,
        delivered: boolean,
        next_attempt_at: number | null
    ) {
        const { hooks, deliveries } = await this.collections();
        const status: DeliveryStatus = delivered ? 'ok' : next_attempt_at ? 'pending' : 'failed';
        await deliveries.updateOne({ account_id: delivery.account_id, id: delivery.id }, {
            $set: {
                status,
                next_attempt_at: delivered ? null : next_attempt_at,
                lease_until: null,
                delivered_at: delivered ? attempt.at : null
            },
            $inc: { attempts: 1 },
            $push: { attempt_log: { $each: [attempt], $slice: -MAX_ATTEMPTS } }
        } as any);
        // The webhook shows how its latest delivery went; a retry still to come isn't final
        if (status !== 'pending') {
            await hooks.updateOne(
                { account_id: delivery.account_id, id: delivery.webhook_id },
                { $set: { last_delivery_at: attempt.at, last_delivery_status: status } }
            );
        }
        return status;
    }

    /** A delivery whose webhook is gone: drops it. */
    async drop_delivery(delivery: WebhookDelivery) {
        const { deliveries } = await this.collections();
        await deliveries.deleteOne({ account_id: delivery.account_id, id: delivery.id });
    }
}
