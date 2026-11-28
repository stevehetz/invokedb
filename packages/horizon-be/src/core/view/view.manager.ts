import { Injectable } from '@nestjs/common';
import { MongoDbCollections } from '../mongodb/collections';
import { ViewSettings, is_view_id } from './view';

const VIEWS = 'tracking:view';

// A saved view of a table (#146)
export interface View extends ViewSettings {
    id: string;
    account_id: number;
    file_id: number;
    created_at: number;
    updated_at: number;
}

// The views of every account, in one collection of the tracking database (so a read-only link
// can look one up by its id later). Every read and write filters on account_id as
// well as the id. The rows a view shows are read from the table's own collection.
@Injectable()
export class ViewManager {
    private indexed = false;

    constructor(private _collections: MongoDbCollections) {}

    private async collection() {
        const views = await this._collections.get_shared_tracking_collection(VIEWS);
        if (!this.indexed) {
            await views.createIndex({ id: 1 }, { unique: true });
            await views.createIndex({ account_id: 1, file_id: 1 });
            this.indexed = true;
        }
        return views;
    }

    /** A table's views, oldest first. */
    async list(account_id: number, file_id: number): Promise<View[]> {
        if (!account_id || !file_id) return [];
        const views = await this.collection();
        const docs = await views
            .find({ account_id, file_id }, { projection: { _id: 0 } })
            .sort({ created_at: 1 })
            .toArray();
        return docs as unknown as View[];
    }

    async count(account_id: number, file_id: number) {
        if (!account_id || !file_id) return 0;
        const views = await this.collection();
        return await views.countDocuments({ account_id, file_id });
    }

    async get(account_id: number, id: string): Promise<View | null> {
        if (!account_id || !is_view_id(id)) return null;
        const views = await this.collection();
        const doc = await views.findOne({ account_id, id }, { projection: { _id: 0 } });
        return (doc as unknown as View) || null;
    }

    async create(view: View) {
        const views = await this.collection();
        await views.insertOne({ ...view });
        return view;
    }

    async update(account_id: number, id: string, changes: Partial<View>) {
        if (!account_id || !is_view_id(id)) return null;
        const views = await this.collection();
        const { account_id: _a, id: _i, file_id: _f, created_at: _c, ...rest } = changes as any;
        await views.updateOne({ account_id, id }, { $set: { ...rest, updated_at: Date.now() } });
        return await this.get(account_id, id);
    }

    async remove(account_id: number, id: string) {
        if (!account_id || !is_view_id(id)) return;
        const views = await this.collection();
        await views.deleteOne({ account_id, id });
    }

    /** Removes the views of a deleted table. */
    async remove_for_table(account_id: number, file_id: number) {
        if (!account_id || !file_id) return;
        const views = await this.collection();
        await views.deleteMany({ account_id, file_id });
    }

    /** Runs an aggregation over a table's rows (in the account's own database). */
    async aggregate_rows(account_id: number, file_id: number, pipeline: any[]) {
        const rows = await this._collections.get_dg_row(account_id, file_id);
        return await rows.aggregate(pipeline).toArray();
    }

    /** How many of a table's rows match a filter. */
    async count_rows(account_id: number, file_id: number, filter: Record<string, unknown>) {
        const rows = await this._collections.get_dg_row(account_id, file_id);
        return await rows.countDocuments(filter);
    }

    /** Some of a table's rows. */
    async find_rows(
        account_id: number,
        file_id: number,
        filter: Record<string, unknown>,
        sort: Record<string, 1 | -1>,
        limit: number
    ) {
        const rows = await this._collections.get_dg_row(account_id, file_id);
        return await rows.find(filter).sort(sort).limit(limit).toArray();
    }
}
