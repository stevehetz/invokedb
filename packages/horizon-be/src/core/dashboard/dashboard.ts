// Dashboards (#209): a named page of tiles, each a chart, a table or a stat (one number) over a
// table, optionally through one of its saved views (#146) for the filters, sort and hidden
// columns. Tiles hold references (a table id, a view id), never rows, so a dashboard always
// shows the data as it is now. A dashboard can be shared read-only by a link whose token the
// owner can replace or revoke. Pure rules only (no I/O); dashboard.manager.ts stores them.
import { randomBytes } from 'crypto';
import { ViewColumn } from '../view/view';

export type TileType = 'chart' | 'table' | 'stat';
export type StatAgg = 'count' | 'sum' | 'avg' | 'min' | 'max';

export const TILE_TYPES: TileType[] = ['chart', 'table', 'stat'];
export const STAT_AGGS: StatAgg[] = ['count', 'sum', 'avg', 'min', 'max'];

export const DASHBOARD_LIMITS = {
    // Per account, until the plans in #137 set their own
    max_per_account: 20,
    max_tiles: 24,
    max_name_length: 100,
    max_title_length: 100,
    // The rows a table tile shows
    max_table_rows: 50,
    default_table_rows: 10
};

// The public link's read limits, per client IP and per dashboard
export const DASHBOARD_RATE_LIMITS = {
    per_ip: 60,
    per_dashboard: 600,
    window_ms: 60 * 1000
};

export interface Tile {
    id: string;
    type: TileType;
    // Shown above the tile; empty means the view's (or the table's) name
    title: string;
    file_id: number;
    // A view of the tile's table: required for a chart (a chart view), optional otherwise
    view_id: string | null;
    // Spans the whole row of the page rather than half of it
    wide: boolean;
    // A table tile's row count
    limit: number | null;
    // A stat tile's number: rows counted, or a number column summed, averaged, ...
    agg: StatAgg | null;
    value_field: string | null;
}

export interface DashboardSettings {
    name: string;
    tiles: Tile[];
}

// A refusal the user can act on; the HTTP layer answers it with a 400
export class DashboardError extends Error {}

const SETTING_KEYS = ['name', 'tiles'];
const TILE_KEYS = [
    'id',
    'type',
    'title',
    'file_id',
    'view_id',
    'wide',
    'limit',
    'agg',
    'value_field'
];

const DASHBOARD_ID = /^dash_[0-9a-f]{24}$/;
const SHARE_TOKEN = /^dsh_[0-9a-f]{32}$/;
const TILE_ID = /^tile_[0-9a-f]{12}$/;
const VIEW_ID = /^view_[0-9a-f]{24}$/;

export function new_dashboard_id() {
    return `dash_${randomBytes(12).toString('hex')}`;
}

export function is_dashboard_id(id: unknown): id is string {
    return typeof id === 'string' && DASHBOARD_ID.test(id);
}

/** A share link's token: 128 random bits, unrelated to the dashboard's id. */
export function new_share_token() {
    return `dsh_${randomBytes(16).toString('hex')}`;
}

export function is_share_token(token: unknown): token is string {
    return typeof token === 'string' && SHARE_TOKEN.test(token);
}

export function new_tile_id() {
    return `tile_${randomBytes(6).toString('hex')}`;
}

function is_plain_object(value: unknown): value is Record<string, unknown> {
    return (
        value !== null &&
        typeof value === 'object' &&
        !Array.isArray(value) &&
        Object.getPrototypeOf(value) === Object.prototype
    );
}

function check_keys(obj: Record<string, unknown>, allowed: string[], what: string) {
    const unknown = Object.keys(obj).filter(k => !allowed.includes(k));
    if (unknown.length > 0) {
        throw new DashboardError(`Unknown ${what}: ${unknown[0].slice(0, 50)}`);
    }
}

function parse_name(name: unknown) {
    if (typeof name !== 'string' || name.trim().length === 0) {
        throw new DashboardError('Give the dashboard a name');
    }
    const trimmed = name.trim();
    if (trimmed.length > DASHBOARD_LIMITS.max_name_length) {
        throw new DashboardError(
            `A dashboard's name can be at most ${DASHBOARD_LIMITS.max_name_length} characters`
        );
    }
    return trimmed;
}

function parse_tile(t: unknown, i: number, seen: Set<string>): Tile {
    const what = `Tile ${i + 1}`;
    if (!is_plain_object(t)) throw new DashboardError(`${what} must be an object`);
    check_keys(t, TILE_KEYS, `${what.toLowerCase()} setting`);

    if (!TILE_TYPES.includes(t.type as TileType)) {
        throw new DashboardError(`${what}: type must be ${TILE_TYPES.join(', ')}`);
    }
    const type = t.type as TileType;

    let title = '';
    if (t.title !== undefined && t.title !== null) {
        if (typeof t.title !== 'string') throw new DashboardError(`${what}: title must be text`);
        title = t.title.trim();
        if (title.length > DASHBOARD_LIMITS.max_title_length) {
            throw new DashboardError(
                `${what}: a title can be at most ${DASHBOARD_LIMITS.max_title_length} characters`
            );
        }
    }

    const file_id = Number(t.file_id);
    if (t.file_id === null || t.file_id === '' || !Number.isInteger(file_id) || file_id <= 0) {
        throw new DashboardError(`${what}: pick a table`);
    }

    let view_id: string | null = null;
    if (t.view_id !== undefined && t.view_id !== null && t.view_id !== '') {
        if (typeof t.view_id !== 'string' || !VIEW_ID.test(t.view_id)) {
            throw new DashboardError(`${what}: unknown view`);
        }
        view_id = t.view_id;
    }
    if (type === 'chart' && !view_id) throw new DashboardError(`${what}: pick a chart view`);

    if (t.wide !== undefined && typeof t.wide !== 'boolean') {
        throw new DashboardError(`${what}: wide must be true or false`);
    }

    let limit: number | null = null;
    if (type === 'table') {
        limit = DASHBOARD_LIMITS.default_table_rows;
        if (t.limit !== undefined && t.limit !== null) {
            const n = Number(t.limit);
            if (!Number.isInteger(n) || n < 1 || n > DASHBOARD_LIMITS.max_table_rows) {
                throw new DashboardError(
                    `${what}: rows must be 1 to ${DASHBOARD_LIMITS.max_table_rows}`
                );
            }
            limit = n;
        }
    } else if (t.limit !== undefined && t.limit !== null) {
        throw new DashboardError(`${what}: limit only goes with a table tile`);
    }

    let agg: StatAgg | null = null;
    let value_field: string | null = null;
    if (type === 'stat') {
        agg = (t.agg === undefined || t.agg === null ? 'count' : t.agg) as StatAgg;
        if (!STAT_AGGS.includes(agg)) {
            throw new DashboardError(`${what}: agg must be ${STAT_AGGS.join(', ')}`);
        }
        if (agg !== 'count') {
            if (typeof t.value_field !== 'string' || t.value_field.length === 0) {
                throw new DashboardError(`${what}: pick a number column`);
            }
            value_field = t.value_field.slice(0, 50);
        } else if (t.value_field !== undefined && t.value_field !== null) {
            throw new DashboardError(`${what}: value_field doesn't go with count`);
        }
    } else if (
        (t.agg !== undefined && t.agg !== null) ||
        (t.value_field !== undefined && t.value_field !== null)
    ) {
        throw new DashboardError(`${what}: agg and value_field only go with a stat tile`);
    }

    // A tile keeps its id across saves (the page keys on it); a new one gets one here
    let id = typeof t.id === 'string' && TILE_ID.test(t.id) ? t.id : new_tile_id();
    while (seen.has(id)) id = new_tile_id();
    seen.add(id);

    return { id, type, title, file_id, view_id, wide: t.wide === true, limit, agg, value_field };
}

function parse_tiles(tiles: unknown): Tile[] {
    if (tiles === undefined || tiles === null) return [];
    if (!Array.isArray(tiles)) throw new DashboardError('tiles must be a list');
    if (tiles.length > DASHBOARD_LIMITS.max_tiles) {
        throw new DashboardError(
            `A dashboard can have at most ${DASHBOARD_LIMITS.max_tiles} tiles`
        );
    }
    const seen = new Set<string>();
    return tiles.map((t, i) => parse_tile(t, i, seen));
}

/**
 * A dashboard's settings from a request body. With `update`, only the keys in the body change,
 * and the result holds just those. The tiles' tables, views and columns are checked by the
 * service (check_tile), which reads them.
 */
export function parse_dashboard_settings(
    body: unknown,
    update = false
): Partial<DashboardSettings> {
    if (!is_plain_object(body)) throw new DashboardError('The body must be a JSON object');
    check_keys(body, SETTING_KEYS, 'dashboard setting');
    const out: Partial<DashboardSettings> = {};
    if (!update || body.name !== undefined) out.name = parse_name(body.name);
    if (!update || body.tiles !== undefined) out.tiles = parse_tiles(body.tiles);
    return out;
}

// What check_tile needs of a tile's saved view
export interface TileView {
    file_id: number;
    type: string;
    hidden_fields?: string[];
}

/**
 * Checks a tile against its table's columns and its view (null when it has none, or the view
 * is gone). Saving a dashboard refuses a tile that fails; showing one shows the message in
 * the tile instead, since a table or view can change after the dashboard was saved.
 */
export function check_tile(tile: Tile, columns: ViewColumn[], view: TileView | null) {
    if (tile.view_id) {
        if (!view || view.file_id !== tile.file_id) {
            throw new DashboardError("This tile's view was deleted; edit the tile");
        }
        if (tile.type === 'chart' && view.type !== 'chart') {
            throw new DashboardError("This tile's view isn't a chart view; edit the tile");
        }
    }
    if (tile.type === 'stat' && tile.agg !== 'count') {
        const col = columns.find(c => c.field === tile.value_field);
        if (!col || col.type !== 'number') {
            throw new DashboardError("This tile's number column was deleted or changed");
        }
    }
    if (tile.type === 'table' && table_tile_columns(columns, view).length === 0) {
        throw new DashboardError('This table has no columns to show');
    }
}

// --- Stat tiles ---

/** The aggregation of a stat tile: one number over the rows its filter matches. */
export function stat_pipeline(
    filter: Record<string, unknown>,
    agg: StatAgg,
    value_field: string | null
) {
    const op = agg === 'count' || !value_field ? { $sum: 1 } : { [`$${agg}`]: `$${value_field}` };
    return [{ $match: filter }, { $group: { _id: null, value: op } }];
}

/** A stat tile's number from its aggregation: 0 rows count and sum to 0, else null. */
export function stat_value(docs: { value?: unknown }[], agg: StatAgg): number | null {
    const v = docs && docs[0] ? docs[0].value : undefined;
    if (typeof v === 'number' && isFinite(v)) return v;
    return agg === 'count' || agg === 'sum' ? 0 : null;
}

// --- Table tiles ---

/** The columns a table tile shows: the view's shown ones (all, without a view), no links. */
export function table_tile_columns(columns: ViewColumn[], view: TileView | null) {
    const hidden = (view && view.hidden_fields) || [];
    return columns.filter(c => c.type !== 'link' && !hidden.includes(c.field));
}

/** A table tile's rows: only the shown columns' values (no ids). */
export function table_tile_rows(rows: any[], shown: ViewColumn[]) {
    return (rows || []).map(row => {
        const out: Record<string, unknown> = {};
        shown.forEach(c => {
            const v = row ? row[c.field] : undefined;
            out[c.field] = v === undefined ? null : v;
        });
        return out;
    });
}

// --- The public link ---

/** A tile as the share link shows it: no table or view ids. */
export function public_tile(tile: Tile & { data?: unknown; error?: string | null }) {
    const { file_id: _f, view_id: _v, ...rest } = tile;
    return rest;
}
