import { Injectable } from '@nestjs/common';
import { Account } from '@app/core/account/account.entity';
import { FileDirectoryService } from '../file-directory/file-directory.service';
import { WebFileService } from '../web-file/web-file.service';
import { ViewService } from '../view/view.service';
import { WebFileManager } from '@app/core/web-file/web-file.manager';
import { MongoDbCollections } from '@app/core/mongodb/collections';
import { AiColumnManager } from '@app/core/ai-column/ai-column.manager';
import { OnboardingManager } from '@app/core/onboarding/onboarding.manager';
import {
    ROW_STATE_KEY,
    cell_hash,
    column_type,
    settings_hash
} from '@app/core/ai-column/ai-column';
import {
    Showcase,
    ShowcaseRow,
    ShowcaseTable,
    ShowcaseTableKey,
    ShowcaseView,
    build_showcase
} from '@app/core/demo/showcase';
import _c from '@app/constants';

// Rows written per batch, like an /api/v1 write
const ROWS_PER_BATCH = 100;

interface MadeTable {
    id: number;
    // Column name → field
    fields: Map<string, string>;
    columns: any[];
    // The rows' ids, in the showcase's order
    row_ids: string[];
}

/**
 * Fills a new demo account with the showcase (#333, core/demo/showcase.ts) through the same
 * services the app uses, so it's made like anyone's tables: the table and row caps, link
 * checks and the audit log all apply. Then the AI column's cells get their hashes (filled, no AI
 * spent), the views are saved, a few rows are edited for the history, and the
 * onboarding checklist is dismissed.
 */
@Injectable()
export class DemoSeedService {
    constructor(
        private readonly file_directory_svc: FileDirectoryService,
        private readonly web_file_svc: WebFileService,
        private readonly view_svc: ViewService,
        private readonly web_file_manager: WebFileManager,
        private readonly _collections: MongoDbCollections,
        private readonly ai_columns: AiColumnManager,
        private readonly onboarding_manager: OnboardingManager
    ) {}

    now() {
        return Date.now();
    }

    async seed(account: Account, showcase: Showcase = build_showcase(this.now())) {
        const made = new Map<ShowcaseTableKey, MadeTable>();
        for (const table of showcase.tables) {
            made.set(table.key, await this.make_table(account, table, made));
        }
        await this.fill_ai_column(account, showcase, made);
        for (const view of showcase.views) {
            await this.view_svc.create(account.id, view_body(view, made.get(view.table)));
        }
        for (const edit of showcase.edits) {
            const t = made.get(edit.table);
            const row: Record<string, unknown> = { _id: t.row_ids[edit.row] };
            Object.entries(edit.changes).forEach(([name, v]) => (row[t.fields.get(name)] = v));
            await this.web_file_svc.batch_update_internal(account, t.id, 'data_grid_row', [row]);
        }
        // The checklist is about a new account's first API call, which the demo can't make
        await this.onboarding_manager.dismiss(account.id);
        return { tables: showcase.tables.map(t => made.get(t.key).id) };
    }

    private async make_table(
        account: Account,
        table: ShowcaseTable,
        made: Map<ShowcaseTableKey, MadeTable>
    ): Promise<MadeTable> {
        const file = await this.file_directory_svc.create(
            account.id,
            { name: table.name, parent_id: null, type: 'file', web_file_type: 'data-grid' },
            true
        );
        let field = 'a';
        const fields = new Map<string, string>();
        const columns = table.columns.map((col, i) => {
            if (i > 0) field = WebFileManager.prototype.get_next_column_key.call({}, field);
            fields.set(col.name, field);
            const doc: any = {
                file_directory_id: file.id,
                col_index: i + 1,
                field,
                order: i + 1,
                headerName: col.name,
                width: col.type === 'link' ? 220 : 180,
                col_type: col.type
            };
            if (col.type === 'link') {
                const target = made.get(col.link_to);
                doc.link_table_id = target.id;
                doc.link_display_field = target.fields.get(col.link_display) || null;
            }
            return doc;
        });
        await this.web_file_manager.batch_create(
            account.id,
            file.id,
            _c.MongoDbCollections.data_grid_column,
            columns
        );

        const rows = table.rows.map(row => this.row_data(table, row, fields, made));
        for (let i = 0; i < rows.length; i += ROWS_PER_BATCH) {
            await this.web_file_svc.batch_create_internal(
                account,
                file.id,
                _c.MongoDbCollections.data_grid_row,
                rows.slice(i, i + ROWS_PER_BATCH)
            );
        }
        const coll = await this._collections.get_dg_row(account.id, file.id);
        const docs = await coll
            .find({}, { projection: { _id: 1 } })
            .sort({ row_index: 1 })
            .toArray();
        return { id: file.id, fields, columns, row_ids: docs.map(d => String(d._id)) };
    }

    // A showcase row keyed by field, its link cells as the linked rows' ids
    private row_data(
        table: ShowcaseTable,
        row: ShowcaseRow,
        fields: Map<string, string>,
        made: Map<ShowcaseTableKey, MadeTable>
    ) {
        const data: Record<string, unknown> = {};
        table.columns.forEach(col => {
            const value = row[col.name];
            if (col.type === 'link') {
                const ids = made.get(col.link_to).row_ids;
                const list = Array.isArray(value) ? value.map(n => ids[n]).filter(Boolean) : [];
                data[fields.get(col.name)] = list.length > 0 ? list : null;
            } else {
                data[fields.get(col.name)] = value === undefined ? null : value;
            }
        });
        return data;
    }

    // The AI column's values are in the rows already: each cell gets the hash a fill would
    // give it, so nothing is stale and nothing is asked of the model
    private async fill_ai_column(
        account: Account,
        showcase: Showcase,
        made: Map<ShowcaseTableKey, MadeTable>
    ) {
        const spec = showcase.ai_column;
        const t = made.get(spec.table);
        const settings = {
            field: t.fields.get(spec.column),
            prompt: spec.prompt,
            inputs: spec.inputs.map(name => t.fields.get(name))
        };
        const now = this.now();
        await this.ai_columns.save(account.id, t.id, settings, now);
        const col = t.columns.find(c => c.field === settings.field);
        const hash = settings_hash(settings, column_type(col));

        const coll = await this._collections.get_dg_row(account.id, t.id);
        const projection: Record<string, 1> = { _id: 1 };
        settings.inputs.forEach(f => (projection[f] = 1));
        const docs = await coll.find({}, { projection }).toArray();
        if (docs.length > 0) {
            await coll.bulkWrite(
                docs.map(doc => ({
                    updateOne: {
                        filter: { _id: doc._id },
                        update: {
                            $set: {
                                [`${ROW_STATE_KEY}.${settings.field}`]: {
                                    h: cell_hash(hash, doc, settings.inputs)
                                }
                            }
                        }
                    }
                })),
                { ordered: false }
            );
        }
        await this.ai_columns.mark_filled(account.id, t.id, settings.field, hash, docs.length, now);
    }
}

/** A showcase view as `POST /view` takes it, its columns as the table's fields. */
export function view_body(view: ShowcaseView, table: { id: number; fields: Map<string, string> }) {
    const f = (name: string) => table.fields.get(name);
    const body: Record<string, unknown> = { file_id: table.id, name: view.name, type: view.type };
    if (view.filters) {
        body.filters = view.filters.map(x => ({
            field: f(x.column),
            type: x.type,
            value: x.value
        }));
    }
    if (view.sort) body.sort = { field: f(view.sort.column), dir: view.sort.dir };
    if (view.kanban) body.kanban = { group_field: f(view.kanban.group) };
    if (view.chart) {
        body.chart = {
            kind: view.chart.kind,
            group_field: f(view.chart.group),
            agg: view.chart.agg,
            ...(view.chart.value ? { value_field: f(view.chart.value) } : {})
        };
    }
    if (view.calendar) {
        body.calendar = { date_field: f(view.calendar.date), title_field: f(view.calendar.title) };
    }
    if (view.map) {
        body.map = {
            lat_field: f(view.map.lat),
            lng_field: f(view.map.lng),
            label_field: f(view.map.label)
        };
    }
    return body;
}
