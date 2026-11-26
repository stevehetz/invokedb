import { Injectable } from '@nestjs/common';
import env from '@app/env';
import { MongoDbCollections } from '../mongodb/collections';
import { IncidentLevel, incident_of } from './status';

const STATUS = 'tracking:status';
const HEARTBEAT_ID = 'processor_heartbeat';
const INCIDENT_ID = 'incident';

// The status page's stored state (#212), in the tracking DB: the processor's heartbeat and the
// admin's incident note, one document each. Not per account.
@Injectable()
export class StatusManager {
    constructor(private _collections: MongoDbCollections) {}

    private async collection() {
        return await this._collections.get_shared_tracking_collection(STATUS);
    }

    async beat(server: string, now: number) {
        const c = await this.collection();
        await c.updateOne(
            { _id: HEARTBEAT_ID } as any,
            { $set: { at: new Date(now), server } },
            { upsert: true }
        );
    }

    async heartbeat_at(): Promise<number | null> {
        const c = await this.collection();
        const doc = await c.findOne({ _id: HEARTBEAT_ID } as any);
        const t = doc?.at ? new Date(doc.at).getTime() : NaN;
        return Number.isFinite(t) ? t : null;
    }

    /** A round trip to the tracking database, and the accounts' server when it's another. */
    async ping_mongo() {
        const tracking = await this._collections.get_mongo_db(
            env.HORIZON_MONGO_TRACKING_DB,
            env.HORIZON_MONGO_TRACKING_URI
        );
        await tracking.command({ ping: 1 });
        if (env.HORIZON_MONGO_URI && env.HORIZON_MONGO_URI !== env.HORIZON_MONGO_TRACKING_URI) {
            const accounts = await this._collections.get_mongo_db(env.HORIZON_MONGO_DB);
            await accounts.command({ ping: 1 });
        }
    }

    async incident() {
        const c = await this.collection();
        return incident_of(await c.findOne({ _id: INCIDENT_ID } as any));
    }

    async set_incident(message: string, level: IncidentLevel, now: number) {
        const c = await this.collection();
        await c.updateOne(
            { _id: INCIDENT_ID } as any,
            { $set: { message, level, updated_at: new Date(now) } },
            { upsert: true }
        );
    }

    async clear_incident() {
        const c = await this.collection();
        await c.deleteOne({ _id: INCIDENT_ID } as any);
    }
}
