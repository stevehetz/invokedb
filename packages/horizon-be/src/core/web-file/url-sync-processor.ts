import { Injectable } from '@nestjs/common';
import { WebFileManager } from './web-file.manager';
import { MongoDbCollections } from '../mongodb/collections';
import { TrackingManager } from '../tracking/tracking.manager';
import { SyncSettings } from '../url-import/url-import';
import _c from '@app/constants';

const fs = require('fs');
const { parse: csv } = require('csv-parse');

const BATCH_SIZE = 1000;
// How many key values go in one `$in` when counting the rows an upsert would add
const KEY_CHUNK = 5000;

export interface SyncResult {
    rows: number;
    inserted: number;
    updated: number;
    skipped: number;
    new_columns: string[];
}

interface Plan {
    // For each CSV column, the table field it goes to
    fields: string[];
    new_columns: any[];
    col_types: { [field: string]: string };
    key_index: number;
}

/**
 * Re-syncs a table imported from a URL (#144) from a freshly fetched CSV file. Columns are
 * matched by name; a new name in the source becomes a new column, and a column the source no
 * longer has is kept. `replace` swaps every row for the source's rows; `upsert` updates the
 * rows whose key column matches and adds the rest. Everything is checked (column names and
 * count, field lengths, the plan's row limit) before anything is written.
 */
@Injectable()
export class UrlSyncProcessor {
    // Tables being synced whose delete was requested, so the sync stops writing to them
    private cancelled = new Set<number>();
    private running = new Set<number>();

    constructor(
        private _collections: MongoDbCollections,
        private _web_file_manager: WebFileManager,
        private _tracking_manager: TrackingManager
    ) {}

    private async *records(file_path: string) {
        const read_stream = fs.createReadStream(file_path);
        const parser = csv({ delimiter: ',' });
        read_stream.on('error', err => parser.destroy(err));
        try {
            for await (const record of read_stream.pipe(parser)) yield record as string[];
        } finally {
            read_stream.destroy();
            parser.destroy();
        }
    }

    private async plan(account, file_id: number, header: string[], settings: SyncSettings) {
        const col_coll = await this._collections.get_dg_col(account.id, file_id);
        const all_cols = await col_coll.find({}).toArray();
        const live = all_cols.filter(c => !c.deleted && c.headerName);
        const by_name = new Map(live.map(c => [c.headerName, c]));
        const last = all_cols.reduce((a, c) => (!a || c.col_index > a.col_index ? c : a), null);
        let next_key = last ? this._web_file_manager.get_next_column_key(last.field) : 'a';
        let next_index = last ? last.col_index + 1 : 1;

        const seen = [];
        const fields: string[] = [];
        const new_columns = [];
        header.forEach(name => {
            this._web_file_manager.validate_column_header(seen, name);
            seen.push({ headerName: name });
            const existing = by_name.get(name);
            if (existing) {
                fields.push(existing.field);
                return;
            }
            new_columns.push({
                file_directory_id: file_id,
                headerName: name,
                field: next_key,
                width: 200,
                order: next_index,
                col_index: next_index
            });
            fields.push(next_key);
            next_key = this._web_file_manager.get_next_column_key(next_key);
            next_index++;
        });
        if (new_columns.length > 0) {
            await this._tracking_manager.validate_column_count(
                account,
                file_id,
                new_columns.length
            );
        }

        let key_index = -1;
        if (settings.mode === 'upsert') {
            key_index = header.indexOf(settings.key_column);
            if (key_index === -1) {
                throw new Error(
                    `The source has no "${settings.key_column}" column to match rows on`
                );
            }
        }
        const col_types = {};
        live.forEach(c => (col_types[c.field] = c.col_type || 'string'));
        return { fields, new_columns, col_types, key_index } as Plan;
    }

    private row_of(plan: Plan, record: string[], file_id: number) {
        if (record.length !== plan.fields.length) {
            throw new Error('Every row must have as many fields as the header');
        }
        const row: any = {};
        record.forEach((cell, i) => {
            this._web_file_manager.validate_field(cell);
            const field = plan.fields[i];
            row[field] = this._web_file_manager.format_row_value(cell, plan.col_types[field]);
        });
        row.file_directory_id = file_id;
        return row;
    }

    private key_of(plan: Plan, row: any) {
        const value = row[plan.fields[plan.key_index]];
        return value === null || value === undefined ? null : value;
    }

    /** Stops a running sync of this table (it is being deleted). */
    cancel(file_id: number) {
        if (this.running.has(file_id)) this.cancelled.add(file_id);
    }

    /**
     * `on_rows_replaced` runs once a replace has deleted the table's old rows (even if writing
     * the new ones then fails), so links to the old rows can be cleared (#175).
     */
    async sync(
        account,
        file_id: number,
        file_path: string,
        settings: SyncSettings,
        on_rows_replaced?: () => Promise<void>
    ) {
        this.running.add(file_id);
        this.cancelled.delete(file_id);
        try {
            return await this.run(account, file_id, file_path, settings, on_rows_replaced);
        } finally {
            this.running.delete(file_id);
            this.cancelled.delete(file_id);
        }
    }

    private async run(
        account,
        file_id: number,
        file_path: string,
        settings: SyncSettings,
        on_rows_replaced?: () => Promise<void>
    ) {
        const deadline = Date.now() + _c.JOB_PROCESSOR_TIMEOUT_MIN * 60 * 1000;
        const check = () => {
            if (this.cancelled.has(file_id)) throw new Error('File delete request');
            if (Date.now() > deadline) {
                throw new Error(`Job timed out after ${_c.JOB_PROCESSOR_TIMEOUT_MIN} minutes`);
            }
        };
        let plan: Plan;
        // First pass: check every row, count them and (for an upsert) collect the keys
        let source_rows = 0;
        let skipped = 0;
        const keys = new Map<string, any>();
        for await (const record of this.records(file_path)) {
            check();
            if (!plan) {
                plan = await this.plan(account, file_id, record, settings);
                continue;
            }
            const row = this.row_of(plan, record, file_id);
            if (plan.key_index === -1) {
                source_rows++;
                continue;
            }
            const key = this.key_of(plan, row);
            if (key === null) skipped++;
            else keys.set(JSON.stringify(key), key);
        }
        if (!plan) throw new Error('No data to process');

        const row_coll = await this._collections.get_dg_row(account.id, file_id);
        // The keys the table already has: those rows are updated, the others added
        const existing_keys = new Set<string>();
        // Nothing is written when the account is already at its storage cap (#183)
        await this._tracking_manager.check_storage(account);
        if (plan.key_index === -1) {
            await this._tracking_manager.validate_row_count(account, source_rows, file_id);
        } else {
            const key_field = plan.fields[plan.key_index];
            const values = [...keys.values()];
            for (let i = 0; i < values.length; i += KEY_CHUNK) {
                const chunk = values.slice(i, i + KEY_CHUNK);
                const found = await row_coll.distinct(key_field, { [key_field]: { $in: chunk } });
                found.forEach(v => existing_keys.add(JSON.stringify(v)));
            }
            const existing = await row_coll.countDocuments();
            await this._tracking_manager.validate_row_count(
                account,
                existing + values.length - existing_keys.size,
                file_id
            );
        }

        // Second pass: write
        check();
        if (plan.new_columns.length > 0) {
            const col_coll = await this._collections.get_dg_col(account.id, file_id);
            await col_coll.insertMany(plan.new_columns);
        }
        const result: SyncResult = {
            rows: 0,
            inserted: 0,
            updated: 0,
            skipped,
            new_columns: plan.new_columns.map(c => c.headerName)
        };
        if (plan.key_index === -1) {
            await row_coll.deleteMany({});
            let batch = [];
            let row_index = 0;
            try {
                let header = true;
                for await (const record of this.records(file_path)) {
                    if (header) {
                        header = false;
                        continue;
                    }
                    check();
                    batch.push({ ...this.row_of(plan, record, file_id), row_index: ++row_index });
                    if (batch.length >= BATCH_SIZE) {
                        await row_coll.insertMany(batch);
                        batch = [];
                    }
                }
                if (batch.length > 0) await row_coll.insertMany(batch);
            } finally {
                // Every old row is gone, so every link to one is stale; this runs after the
                // inserts so it also clears a link column of this table that points at itself
                if (on_rows_replaced) await on_rows_replaced();
            }
            result.rows = row_index;
            result.inserted = row_index;
        } else {
            const key_field = plan.fields[plan.key_index];
            let last_index = await this._web_file_manager.get_last_grid_row_index(
                account.id,
                file_id
            );
            let ops = [];
            const flush = async () => {
                if (ops.length === 0) return;
                const res = await row_coll.bulkWrite(ops, { ordered: true });
                result.inserted += res.upsertedCount;
                result.updated += res.matchedCount;
                ops = [];
            };
            let header = true;
            for await (const record of this.records(file_path)) {
                if (header) {
                    header = false;
                    continue;
                }
                check();
                const row = this.row_of(plan, record, file_id);
                const key = this.key_of(plan, row);
                if (key === null) continue;
                delete row.file_directory_id;
                const key_text = JSON.stringify(key);
                const update: any = { $set: row };
                if (!existing_keys.has(key_text)) {
                    // A new row; a later row with the same key updates it
                    existing_keys.add(key_text);
                    update.$setOnInsert = { file_directory_id: file_id, row_index: ++last_index };
                }
                ops.push({
                    updateOne: { filter: { [key_field]: key }, update, upsert: true }
                });
                result.rows++;
                if (ops.length >= BATCH_SIZE) await flush();
            }
            await flush();
        }
        await this._tracking_manager.refresh_row_count(account, file_id);
        return result;
    }
}
