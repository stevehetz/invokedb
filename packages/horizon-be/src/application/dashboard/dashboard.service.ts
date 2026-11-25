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
    ViewColumn,
    ViewError,
    assert_view_columns,
    chart_pipeline,
    chart_points,
    view_columns,
    view_filter_query,
    view_mongo_sort
} from '@app/core/view/view';
import { Dashboard, DashboardManager } from '@app/core/dashboard/dashboard.manager';
import {
    DASHBOARD_LIMITS,
    DashboardError,
    DashboardSettings,
    Tile,
    check_tile,
    new_dashboard_id,
    new_share_token,
    parse_dashboard_settings,
    public_tile,
    stat_pipeline,
    stat_value,
    table_tile_columns,
    table_tile_rows
} from '@app/core/dashboard/dashboard';
import logger from '@app/logger';

export const DASHBOARD_NOT_FOUND = "This dashboard doesn't exist or is no longer shared.";

// What one data request has read already, so tiles on the same table read its columns once
interface ReadCache {
    files: Map<number, any>;
    columns: Map<number, ViewColumn[]>;
    views: Map<string, View | null>;
}

// Dashboards (#209): pages of chart, table and stat tiles over the account's tables and saved
// views, read live on every request, and their read-only share links.
@Injectable()
export class DashboardService {
    constructor(
        private file_directory_svc: FileDirectoryService,
        private account_svc: AccountService,
        private tracking_manager: TrackingManager,
        private web_file_manager: WebFileManager,
        private view_manager: ViewManager,
        private dashboard_manager: DashboardManager
    ) {}

    // Overridden by the unit tests
    now() {
        return Date.now();
    }

    private checked<T>(fn: () => T): T {
        try {
            return fn();
        } catch (ex) {
            if (ex instanceof DashboardError) throw new BadRequestException(ex.message);
            throw ex;
        }
    }

    private cache(): ReadCache {
        return { files: new Map(), columns: new Map(), views: new Map() };
    }

    // A table of the account's that hasn't been deleted, or null
    private async table(acct_id: number, file_id: number, cache: ReadCache) {
        if (!cache.files.has(file_id)) {
            const file = await this.file_directory_svc.get_by_id(file_id);
            const ok = file && file.account_id === acct_id && file.type === 'file' && !file.deleted;
            cache.files.set(file_id, ok ? file : null);
        }
        return cache.files.get(file_id);
    }

    private async columns(acct_id: number, file_id: number, cache: ReadCache) {
        if (!cache.columns.has(file_id)) {
            const cols = await this.web_file_manager.get_all(acct_id, file_id, 'data_grid_column');
            cache.columns.set(file_id, view_columns((cols && cols.data) || []));
        }
        return cache.columns.get(file_id);
    }

    private async saved_view(acct_id: number, view_id: string | null, cache: ReadCache) {
        if (!view_id) return null;
        if (!cache.views.has(view_id)) {
            cache.views.set(view_id, (await this.view_manager.get(acct_id, view_id)) || null);
        }
        return cache.views.get(view_id);
    }

    private async owned(acct_id: number, id: string) {
        const dashboard = await this.dashboard_manager.get(acct_id, id);
        if (!dashboard) throw new NotFoundException('Dashboard not found');
        return dashboard;
    }

    // What the app sees of a dashboard (the account's own)
    view(dashboard: Dashboard) {
        const { account_id: _a, ...rest } = dashboard;
        return rest;
    }

    // Every tile's table and view must be the account's, and fit the tile, when it's saved
    private async check_tiles(acct_id: number, tiles: Tile[]) {
        const cache = this.cache();
        for (let i = 0; i < tiles.length; i++) {
            const tile = tiles[i];
            const what = `Tile ${i + 1}`;
            if (!(await this.table(acct_id, tile.file_id, cache))) {
                throw new BadRequestException(`${what}: table not found`);
            }
            const columns = await this.columns(acct_id, tile.file_id, cache);
            const view = await this.saved_view(acct_id, tile.view_id, cache);
            if (tile.view_id && (!view || view.file_id !== tile.file_id)) {
                throw new BadRequestException(`${what}: view not found`);
            }
            try {
                check_tile(tile, columns, view);
            } catch (ex) {
                if (ex instanceof DashboardError) {
                    throw new BadRequestException(`${what}: ${ex.message}`);
                }
                throw ex;
            }
        }
    }

    /** The account's dashboards and the limits. */
    async list(acct_id: number) {
        const dashboards = await this.dashboard_manager.list(acct_id);
        return { dashboards: dashboards.map(d => this.view(d)), limits: DASHBOARD_LIMITS };
    }

    async get(acct_id: number, id: string) {
        return this.view(await this.owned(acct_id, id));
    }

    /** Body: `{ name, tiles: [{ type, title, file_id, view_id, wide, limit, agg, value_field }] }`. */
    async create(acct_id: number, body: any) {
        const account = await this.account_svc.get(acct_id);
        if (!account) throw new NotFoundException();
        await this.tracking_manager.check_account_lock(account);
        const settings = this.checked(() => parse_dashboard_settings(body)) as DashboardSettings;
        await this.check_tiles(acct_id, settings.tiles);
        if ((await this.dashboard_manager.count(acct_id)) >= DASHBOARD_LIMITS.max_per_account) {
            throw new ForbiddenException(
                `An account can have at most ${DASHBOARD_LIMITS.max_per_account} dashboards`
            );
        }
        const now = this.now();
        const dashboard = await this.dashboard_manager.create({
            ...settings,
            id: new_dashboard_id(),
            account_id: acct_id,
            share_token: null,
            created_at: now,
            updated_at: now
        });
        return this.view(dashboard);
    }

    /** Body: `{ name }`, `{ tiles }` or both; the tiles replace the dashboard's. */
    async update(acct_id: number, id: string, body: any) {
        const dashboard = await this.owned(acct_id, id);
        const changes = this.checked(() => parse_dashboard_settings(body, true));
        if (changes.tiles) await this.check_tiles(acct_id, changes.tiles);
        if (Object.keys(changes).length === 0) return this.view(dashboard);
        return this.view(await this.dashboard_manager.update(acct_id, dashboard.id, changes));
    }

    async remove(acct_id: number, id: string) {
        const dashboard = await this.owned(acct_id, id);
        await this.dashboard_manager.remove(acct_id, dashboard.id);
        return { deleted: dashboard.id };
    }

    /** Shares the dashboard by a new link; the old link (if any) stops working. */
    async share(acct_id: number, id: string) {
        const dashboard = await this.owned(acct_id, id);
        const updated = await this.dashboard_manager.update(acct_id, dashboard.id, {
            share_token: new_share_token()
        });
        return this.view(updated);
    }

    /** Revokes the share link. */
    async unshare(acct_id: number, id: string) {
        const dashboard = await this.owned(acct_id, id);
        const updated = await this.dashboard_manager.update(acct_id, dashboard.id, {
            share_token: null
        });
        return this.view(updated);
    }

    /** The dashboard with each tile's data, read now. */
    async data(acct_id: number, id: string) {
        const dashboard = await this.owned(acct_id, id);
        const tiles = await this.tiles_data(dashboard);
        return { ...this.view(dashboard), tiles };
    }

    /** A shared dashboard by its link's token: its name and tiles' data, no ids. */
    async public_view(token: string) {
        const dashboard = await this.dashboard_manager.get_shared(token);
        if (!dashboard) throw new NotFoundException(DASHBOARD_NOT_FOUND);
        const account = await this.account_svc.get(dashboard.account_id);
        if (!account) throw new NotFoundException(DASHBOARD_NOT_FOUND);
        const tiles = await this.tiles_data(dashboard);
        return {
            name: dashboard.name,
            updated_at: dashboard.updated_at,
            tiles: tiles.map(t => public_tile(t))
        };
    }

    private async tiles_data(dashboard: Dashboard) {
        const cache = this.cache();
        const out = [];
        for (const tile of dashboard.tiles || []) {
            out.push(await this.tile_data(dashboard.account_id, tile, cache));
        }
        return out;
    }

    // One tile with its data, or with an error to show in its place
    private async tile_data(acct_id: number, tile: Tile, cache: ReadCache) {
        const file = await this.table(acct_id, tile.file_id, cache);
        if (!file) {
            return {
                ...tile,
                heading: tile.title,
                data: null,
                error: "This tile's table was deleted; edit the tile"
            };
        }
        const view = await this.saved_view(acct_id, tile.view_id, cache);
        // The heading shown: the tile's title, else its view's or its table's name
        const heading = tile.title || (view && view.name) || file.name;
        try {
            const columns = await this.columns(acct_id, tile.file_id, cache);
            check_tile(tile, columns, view);
            if (view) assert_view_columns(view, columns);
            const filter = view ? view_filter_query(view.filters, columns) : {};
            let data: any;
            if (tile.type === 'chart') {
                const docs = await this.view_manager.aggregate_rows(
                    acct_id,
                    tile.file_id,
                    chart_pipeline(filter, view.chart, columns)
                );
                data = { ...view.chart, ...chart_points(docs as any[]) };
            } else if (tile.type === 'stat') {
                const docs = await this.view_manager.aggregate_rows(
                    acct_id,
                    tile.file_id,
                    stat_pipeline(filter, tile.agg, tile.value_field)
                );
                const col = columns.find(c => c.field === tile.value_field);
                data = {
                    agg: tile.agg,
                    column: col ? col.name : null,
                    value: stat_value(docs as any[], tile.agg)
                };
            } else {
                const shown = table_tile_columns(columns, view);
                const rows = await this.view_manager.find_rows(
                    acct_id,
                    tile.file_id,
                    filter,
                    view_mongo_sort(view ? view.sort : null, columns),
                    tile.limit || DASHBOARD_LIMITS.default_table_rows
                );
                const types = {};
                columns.forEach(c => (types[c.field] = c.type));
                const formatted = this.web_file_manager.format_data_response(rows, types);
                data = {
                    columns: shown,
                    rows: table_tile_rows(formatted, shown),
                    total: await this.dashboard_manager.count_rows(acct_id, tile.file_id, filter)
                };
            }
            return { ...tile, heading, data, error: null };
        } catch (ex) {
            if (ex instanceof DashboardError || ex instanceof ViewError) {
                return { ...tile, heading, data: null, error: ex.message };
            }
            logger.error(`Dashboard tile ${tile.id} not read: ${ex && ex.message}`);
            return { ...tile, heading, data: null, error: "This tile couldn't be read right now" };
        }
    }
}
