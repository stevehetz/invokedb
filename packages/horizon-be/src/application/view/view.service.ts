import {
    BadRequestException,
    ForbiddenException,
    Injectable,
    NotFoundException
} from '@nestjs/common';
import { FileDirectoryService } from '../file-directory/file-directory.service';
import { AccountService } from '../account/account.service';
import { TrackingManager } from '@app/core/tracking/tracking.manager';
import { WebFileManager } from '@app/core/web-file/web-file.manager';
import { View, ViewManager } from '@app/core/view/view.manager';
import {
    VIEW_LIMITS,
    ViewColumn,
    ViewError,
    ViewSettings,
    assert_view_columns,
    chart_pipeline,
    chart_points,
    kanban_group_filter,
    kanban_groups,
    kanban_groups_pipeline,
    new_view_id,
    parse_view_settings,
    view_columns,
    view_filter_query,
    view_mongo_sort
} from '@app/core/view/view';

// Saved views of a table (#146): a named filter, sort and set of hidden columns, shown as the
// grid, as a kanban board or as a chart. A grid view is applied by the grid itself (its filter
// row and sort); a board's cards and a chart's points are read here, with the view's filters.
// Moving a card is an ordinary row update (PUT /web-file/...), so the locks and webhooks apply.
@Injectable()
export class ViewService {
    constructor(
        private file_directory_svc: FileDirectoryService,
        private account_svc: AccountService,
        private tracking_manager: TrackingManager,
        private web_file_manager: WebFileManager,
        private view_manager: ViewManager
    ) {}

    // Overridden by the unit tests
    now() {
        return Date.now();
    }

    private checked<T>(fn: () => T): T {
        try {
            return fn();
        } catch (ex) {
            if (ex instanceof ViewError) throw new BadRequestException(ex.message);
            throw ex;
        }
    }

    // A table of the account's that hasn't been deleted
    private async owned_table(acct_id: number, file_id: unknown) {
        if (file_id === null || file_id === undefined || file_id === '') {
            throw new BadRequestException('Pick a table');
        }
        const file = await this.file_directory_svc.assert_owned(acct_id, file_id);
        if (file.type !== 'file' || file.deleted) throw new NotFoundException('Table not found');
        return file;
    }

    private async columns(acct_id: number, file_id: number): Promise<ViewColumn[]> {
        const cols = await this.web_file_manager.get_all(acct_id, file_id, 'data_grid_column');
        return view_columns((cols && cols.data) || []);
    }

    private async owned(acct_id: number, id: string) {
        const view = await this.view_manager.get(acct_id, id);
        if (!view) throw new NotFoundException('View not found');
        return view;
    }

    // What the app sees of a view (the account's own)
    view(view: View) {
        const { account_id: _a, ...rest } = view;
        return rest;
    }

    /** A table's views, its columns and the limits. */
    async list(acct_id: number, table: unknown) {
        const file = await this.owned_table(acct_id, table);
        const views = await this.view_manager.list(acct_id, file.id);
        const columns = await this.columns(acct_id, file.id);
        return { views: views.map(v => this.view(v)), columns, limits: VIEW_LIMITS };
    }

    async get(acct_id: number, id: string) {
        return this.view(await this.owned(acct_id, id));
    }

    /** Body: `{ file_id, name, type, filters, sort, hidden_fields, kanban?, chart? }`. */
    async create(acct_id: number, body: any) {
        const b = body && typeof body === 'object' ? body : {};
        const account = await this.account_svc.get(acct_id);
        if (!account) throw new NotFoundException();
        await this.tracking_manager.check_account_lock(account);
        const file = await this.owned_table(acct_id, b.file_id);
        const columns = await this.columns(acct_id, file.id);
        const settings = this.checked(() => parse_view_settings(b, columns)) as ViewSettings;
        if ((await this.view_manager.count(acct_id, file.id)) >= VIEW_LIMITS.max_per_table) {
            throw new ForbiddenException(
                `A table can have at most ${VIEW_LIMITS.max_per_table} views`
            );
        }
        const now = this.now();
        const view = await this.view_manager.create({
            ...settings,
            id: new_view_id(),
            account_id: acct_id,
            file_id: file.id,
            created_at: now,
            updated_at: now
        });
        return this.view(view);
    }

    /** Body: any of the settings (`{ name }` renames it). */
    async update(acct_id: number, id: string, body: any) {
        const view = await this.owned(acct_id, id);
        if (body && typeof body === 'object' && body.file_id !== undefined) {
            if (Number(body.file_id) !== view.file_id) {
                throw new BadRequestException("A view's table can't be changed");
            }
        }
        const file = await this.owned_table(acct_id, view.file_id);
        const columns = await this.columns(acct_id, file.id);
        const changes = this.checked(() => parse_view_settings(body, columns, view));
        if (Object.keys(changes).length === 0) return this.view(view);
        return this.view(await this.view_manager.update(acct_id, view.id, changes));
    }

    async remove(acct_id: number, id: string) {
        const view = await this.owned(acct_id, id);
        await this.view_manager.remove(acct_id, view.id);
        return { deleted: view.id };
    }

    // A view of the given type, with its table's current columns
    private async live(acct_id: number, id: string, type: 'kanban' | 'chart') {
        const view = await this.owned(acct_id, id);
        if (view.type !== type) throw new BadRequestException(`This isn't a ${type} view`);
        const file = await this.owned_table(acct_id, view.file_id);
        const columns = await this.columns(acct_id, file.id);
        this.checked(() => assert_view_columns(view, columns));
        return { view, columns, filter: view_filter_query(view.filters, columns) };
    }

    private format_rows(rows: any[], columns: ViewColumn[]) {
        const types = {};
        columns.forEach(c => (types[c.field] = c.type));
        return this.web_file_manager.format_data_response(rows, types);
    }

    /**
     * A kanban view's board: a column per value of its group column (empty values first, as
     * `value: null`), each with its row count and its first cards in the view's sort.
     */
    async kanban(acct_id: number, id: string) {
        const { view, columns, filter } = await this.live(acct_id, id, 'kanban');
        const field = view.kanban.group_field;
        const docs = await this.view_manager.aggregate_rows(
            acct_id,
            view.file_id,
            kanban_groups_pipeline(filter, field)
        );
        const { groups, truncated } = kanban_groups(docs as any[]);
        const sort = view_mongo_sort(view.sort, columns);
        const out = [];
        for (const g of groups) {
            const rows = await this.view_manager.find_rows(
                acct_id,
                view.file_id,
                kanban_group_filter(filter, field, g.value),
                sort,
                VIEW_LIMITS.max_kanban_cards
            );
            out.push({ ...g, rows: this.format_rows(rows, columns) });
        }
        return { group_field: field, groups: out, truncated, columns };
    }

    /** A chart view's points: `{ label, value }`, counted or summed per value of its column. */
    async chart(acct_id: number, id: string) {
        const { view, columns, filter } = await this.live(acct_id, id, 'chart');
        const docs = await this.view_manager.aggregate_rows(
            acct_id,
            view.file_id,
            chart_pipeline(filter, view.chart, columns)
        );
        return { ...view.chart, ...chart_points(docs as any[]) };
    }
}
