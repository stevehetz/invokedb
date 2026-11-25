import { Injectable } from '@nestjs/common';
import { MongoDbCollections } from '../mongodb/collections';
import { DashboardSettings, is_dashboard_id, is_share_token } from './dashboard';

const DASHBOARDS = 'tracking:dashboard';

// A dashboard (#209)
export interface Dashboard extends DashboardSettings {
    id: string;
    account_id: number;
    // The read-only link's token; null when it isn't shared
    share_token: string | null;
    created_at: number;
    updated_at: number;
}

// The dashboards of every account, in one collection of the tracking database, so a share link
// (just its token) can be looked up without knowing the account. Every read and write from the
// app filters on account_id as well as the id; only the public lookup (get_shared) doesn't.
@Injectable()
export class DashboardManager {
    private indexed = false;

    constructor(private _collections: MongoDbCollections) {}

    private async collection() {
        const dashboards = await this._collections.get_shared_tracking_collection(DASHBOARDS);
        if (!this.indexed) {
            await dashboards.createIndex({ id: 1 }, { unique: true });
            await dashboards.createIndex({ account_id: 1 });
            await dashboards.createIndex(
                { share_token: 1 },
                { unique: true, partialFilterExpression: { share_token: { $type: 'string' } } }
            );
            this.indexed = true;
        }
        return dashboards;
    }

    /** The account's dashboards, oldest first. */
    async list(account_id: number): Promise<Dashboard[]> {
        if (!account_id) return [];
        const dashboards = await this.collection();
        const docs = await dashboards
            .find({ account_id }, { projection: { _id: 0 } })
            .sort({ created_at: 1 })
            .toArray();
        return docs as unknown as Dashboard[];
    }

    async count(account_id: number) {
        if (!account_id) return 0;
        const dashboards = await this.collection();
        return await dashboards.countDocuments({ account_id });
    }

    async get(account_id: number, id: string): Promise<Dashboard | null> {
        if (!account_id || !is_dashboard_id(id)) return null;
        const dashboards = await this.collection();
        const doc = await dashboards.findOne({ account_id, id }, { projection: { _id: 0 } });
        return (doc as unknown as Dashboard) || null;
    }

    /** A shared dashboard by its link's token alone. */
    async get_shared(token: string): Promise<Dashboard | null> {
        if (!is_share_token(token)) return null;
        const dashboards = await this.collection();
        const doc = await dashboards.findOne({ share_token: token }, { projection: { _id: 0 } });
        return (doc as unknown as Dashboard) || null;
    }

    async create(dashboard: Dashboard) {
        const dashboards = await this.collection();
        await dashboards.insertOne({ ...dashboard });
        return dashboard;
    }

    async update(account_id: number, id: string, changes: Partial<Dashboard>) {
        if (!account_id || !is_dashboard_id(id)) return null;
        const dashboards = await this.collection();
        const { account_id: _a, id: _i, created_at: _c, ...rest } = changes as any;
        await dashboards.updateOne(
            { account_id, id },
            { $set: { ...rest, updated_at: Date.now() } }
        );
        return await this.get(account_id, id);
    }

    async remove(account_id: number, id: string) {
        if (!account_id || !is_dashboard_id(id)) return;
        const dashboards = await this.collection();
        await dashboards.deleteOne({ account_id, id });
    }

    /** How many of a table's rows match a filter. */
    async count_rows(account_id: number, file_id: number, filter: Record<string, unknown>) {
        const rows = await this._collections.get_dg_row(account_id, file_id);
        return await rows.countDocuments(filter);
    }
}
