// Saved views of a table (#146): a named filter, sort and set of hidden columns, shown as the
// grid, as kanban cards grouped by a column, as a chart over a column, or (#211) as a calendar
// over a date column or a map over latitude and longitude columns. Pure rules only (no I/O):
// what a view's settings may be, the Mongo filter its filters make, and the aggregation a chart
// runs. view.manager.ts stores the views.
//
// Filters are kept as the grid sends them (a column's Mongo field, a filter type and the value
// as typed), so a grid view puts them back in the grid's filter row unchanged. Nothing from a
// body reaches Mongo as a key or operator: fields come from the table's columns and filter
// types from the fixed lists below.
import { randomBytes } from 'crypto';
import { parse_utc_date } from '../date';

export type ViewType = 'grid' | 'kanban' | 'chart' | 'calendar' | 'map';
export type ViewColumnType = 'string' | 'number' | 'date' | 'link';
export type ChartKind = 'bar' | 'line' | 'pie';
export type ChartAgg = 'count' | 'sum';

export const VIEW_TYPES: ViewType[] = ['grid', 'kanban', 'chart', 'calendar', 'map'];
export const CHART_KINDS: ChartKind[] = ['bar', 'line', 'pie'];
export const CHART_AGGS: ChartAgg[] = ['count', 'sum'];

// The grid's filter types (grid-filter.js), per column type
export const STRING_FILTER_TYPES = ['equals', 'contains'];
export const NUMBER_FILTER_TYPES = [
    'equals',
    'lessThan',
    'lessThanOrEqual',
    'greaterThan',
    'greaterThanOrEqual'
];

// The grid's own row-number column: sortable, but not a stored field
export const ROW_NUM = 'row_num';

export const VIEW_LIMITS = {
    // Per table, until the plans in #137 set their own
    max_per_table: 50,
    max_name_length: 100,
    max_filters: 20,
    max_filter_value_length: 2000,
    // A kanban board: its columns (values of the group column), and the cards loaded per column
    max_kanban_groups: 50,
    max_kanban_cards: 100,
    // A chart's bars, points or slices
    max_chart_points: 50,
    // A calendar reads at most this many days at once (a month grid shows 42), and rows
    max_calendar_days: 62,
    max_calendar_rows: 500,
    // A map's points
    max_map_points: 1000
};

// A table column as a view sees it
export interface ViewColumn {
    // The Mongo field ('a', 'b', ...), which stays the same when the column is renamed
    field: string;
    name: string;
    type: ViewColumnType;
}

export interface ViewFilter {
    field: string;
    type: string;
    // As typed in the grid's filter row
    value: string;
}

export interface ViewSort {
    // A column's field, or row_num (the order rows were added)
    field: string;
    dir: 'asc' | 'desc';
}

export interface KanbanSettings {
    // The column the cards are grouped by (a text or number column)
    group_field: string;
}

export interface ChartSettings {
    kind: ChartKind;
    // The column of the bars, points or slices
    group_field: string;
    agg: ChartAgg;
    // The number column summed, with agg 'sum'
    value_field: string | null;
}

export interface CalendarSettings {
    // The date column the rows are placed by
    date_field: string;
    // The text or number column shown as each row's title (null: "Row <n>")
    title_field: string | null;
}

export interface MapSettings {
    // Number columns, in degrees
    lat_field: string;
    lng_field: string;
    // The text or number column shown as each point's label (null: "Row <n>")
    label_field: string | null;
}

export interface ViewSettings {
    name: string;
    type: ViewType;
    filters: ViewFilter[];
    sort: ViewSort | null;
    // Columns the view doesn't show (fields); new columns show
    hidden_fields: string[];
    kanban: KanbanSettings | null;
    chart: ChartSettings | null;
    calendar: CalendarSettings | null;
    map: MapSettings | null;
}

// A refusal the user can act on; the HTTP layer answers it with a 400
export class ViewError extends Error {}

const SETTING_KEYS = [
    'name',
    'type',
    'filters',
    'sort',
    'hidden_fields',
    'kanban',
    'chart',
    'calendar',
    'map',
    // Read by the service: the view's table, which can't change
    'file_id'
];

const VIEW_ID = /^view_[0-9a-f]{24}$/;

export function new_view_id() {
    return `view_${randomBytes(12).toString('hex')}`;
}

export function is_view_id(id: unknown): id is string {
    return typeof id === 'string' && VIEW_ID.test(id);
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
        throw new ViewError(`Unknown ${what}: ${unknown[0].slice(0, 50)}`);
    }
}

/** The table's columns as stored (`data_grid_column` docs), in grid order. */
export function view_columns(cols: any[]): ViewColumn[] {
    return (cols || [])
        .filter(c => c && !c.deleted && typeof c.field === 'string' && c.field.length > 0)
        .sort((a, b) => Number(a.order) - Number(b.order))
        .map(c => ({
            field: c.field,
            name: String(c.headerName || c.field),
            type: (['number', 'date', 'link'].includes(c.col_type)
                ? c.col_type
                : 'string') as ViewColumnType
        }));
}

function column(columns: ViewColumn[], field: unknown, what: string) {
    if (typeof field !== 'string' || field.length === 0) {
        throw new ViewError(`${what}: pick a column`);
    }
    const col = columns.find(c => c.field === field);
    if (!col) throw new ViewError(`${what}: unknown column ${field.slice(0, 50)}`);
    return col;
}

export function filter_types(type: ViewColumnType) {
    if (type === 'number' || type === 'date') return NUMBER_FILTER_TYPES;
    if (type === 'string') return STRING_FILTER_TYPES;
    return [];
}

// A filter's value in the column's type, or undefined when it doesn't parse
function filter_value(col: ViewColumn, value: string) {
    if (col.type === 'number') {
        const n = parseFloat(value);
        return isFinite(n) ? n : undefined;
    }
    if (col.type === 'date') {
        const d = parse_utc_date(value);
        return d && !isNaN(d.getTime()) ? d : undefined;
    }
    return value;
}

function parse_name(name: unknown) {
    if (typeof name !== 'string' || name.trim().length === 0) {
        throw new ViewError('Give the view a name');
    }
    const trimmed = name.trim();
    if (trimmed.length > VIEW_LIMITS.max_name_length) {
        throw new ViewError(
            `A view's name can be at most ${VIEW_LIMITS.max_name_length} characters`
        );
    }
    return trimmed;
}

function parse_filters(filters: unknown, columns: ViewColumn[]): ViewFilter[] {
    if (filters === undefined || filters === null) return [];
    if (!Array.isArray(filters)) throw new ViewError('filters must be a list');
    if (filters.length > VIEW_LIMITS.max_filters) {
        throw new ViewError(`A view can have at most ${VIEW_LIMITS.max_filters} filters`);
    }
    const seen = new Set<string>();
    return filters.map((f, i) => {
        const what = `Filter ${i + 1}`;
        if (!is_plain_object(f)) throw new ViewError(`${what} must be an object`);
        check_keys(f, ['field', 'type', 'value'], `${what.toLowerCase()} setting`);
        const col = column(columns, f.field, what);
        if (seen.has(col.field)) throw new ViewError(`${what}: ${col.name} is filtered twice`);
        seen.add(col.field);
        const types = filter_types(col.type);
        if (types.length === 0) throw new ViewError(`${what}: ${col.name} can't be filtered`);
        if (typeof f.type !== 'string' || !types.includes(f.type)) {
            throw new ViewError(`${what}: ${col.name} takes ${types.join(', ')}`);
        }
        let value = f.value;
        if (typeof value === 'number' && isFinite(value)) value = String(value);
        if (typeof value !== 'string' || value.trim().length === 0) {
            throw new ViewError(`${what}: a value is required`);
        }
        if (value.length > VIEW_LIMITS.max_filter_value_length) {
            throw new ViewError(
                `${what}: values can be at most ${VIEW_LIMITS.max_filter_value_length} characters`
            );
        }
        if (filter_value(col, value) === undefined) {
            throw new ViewError(`${what}: ${col.name} is a ${col.type} column`);
        }
        return { field: col.field, type: f.type, value };
    });
}

function parse_sort(sort: unknown, columns: ViewColumn[]): ViewSort | null {
    if (sort === undefined || sort === null) return null;
    if (!is_plain_object(sort)) throw new ViewError('sort must be { field, dir }');
    check_keys(sort, ['field', 'dir'], 'sort setting');
    const dir = sort.dir === undefined ? 'asc' : sort.dir;
    if (dir !== 'asc' && dir !== 'desc') throw new ViewError('Sort: dir must be asc or desc');
    if (sort.field === ROW_NUM) return { field: ROW_NUM, dir };
    const col = column(columns, sort.field, 'Sort');
    if (col.type === 'link') throw new ViewError(`Sort: ${col.name} can't be sorted`);
    return { field: col.field, dir };
}

function parse_hidden(hidden: unknown, columns: ViewColumn[]): string[] {
    if (hidden === undefined || hidden === null) return [];
    if (!Array.isArray(hidden)) throw new ViewError('hidden_fields must be a list of columns');
    const out: string[] = [];
    hidden.forEach(field => {
        const col = column(columns, field, 'Hidden columns');
        if (!out.includes(col.field)) out.push(col.field);
    });
    if (columns.length > 0 && out.length >= columns.length) {
        throw new ViewError('A view has to show at least one column');
    }
    return out;
}

function group_column(columns: ViewColumn[], field: unknown, what: string, types: string[]) {
    const col = column(columns, field, what);
    if (!types.includes(col.type)) {
        throw new ViewError(`${what}: ${col.name} is a ${col.type} column; pick another`);
    }
    return col;
}

function parse_kanban(kanban: unknown, columns: ViewColumn[]): KanbanSettings {
    if (!is_plain_object(kanban)) throw new ViewError('A kanban view needs a column to group by');
    check_keys(kanban, ['group_field'], 'kanban setting');
    const col = group_column(columns, kanban.group_field, 'Group by', ['string', 'number']);
    return { group_field: col.field };
}

function parse_chart(chart: unknown, columns: ViewColumn[]): ChartSettings {
    if (!is_plain_object(chart)) throw new ViewError('A chart view needs a column to chart');
    check_keys(chart, ['kind', 'group_field', 'agg', 'value_field'], 'chart setting');
    const kind = chart.kind === undefined ? 'bar' : chart.kind;
    if (!CHART_KINDS.includes(kind as ChartKind)) {
        throw new ViewError(`Chart: kind must be ${CHART_KINDS.join(', ')}`);
    }
    const agg = chart.agg === undefined ? 'count' : chart.agg;
    if (!CHART_AGGS.includes(agg as ChartAgg)) {
        throw new ViewError(`Chart: agg must be ${CHART_AGGS.join(' or ')}`);
    }
    const group = group_column(columns, chart.group_field, 'Chart column', [
        'string',
        'number',
        'date'
    ]);
    let value_field: string | null = null;
    if (agg === 'sum') {
        const col = group_column(columns, chart.value_field, 'Sum of', ['number']);
        value_field = col.field;
    } else if (chart.value_field !== undefined && chart.value_field !== null) {
        throw new ViewError('Chart: value_field only goes with agg sum');
    }
    return { kind: kind as ChartKind, group_field: group.field, agg: agg as ChartAgg, value_field };
}

// A column shown as a title or label: a text or number column, or none
function title_column(columns: ViewColumn[], field: unknown, what: string) {
    if (field === undefined || field === null || field === '') return null;
    return group_column(columns, field, what, ['string', 'number']).field;
}

function parse_calendar(calendar: unknown, columns: ViewColumn[]): CalendarSettings {
    if (!is_plain_object(calendar)) throw new ViewError('A calendar view needs a date column');
    check_keys(calendar, ['date_field', 'title_field'], 'calendar setting');
    const date = group_column(columns, calendar.date_field, 'Date column', ['date']);
    return {
        date_field: date.field,
        title_field: title_column(columns, calendar.title_field, 'Title column')
    };
}

function parse_map(map: unknown, columns: ViewColumn[]): MapSettings {
    if (!is_plain_object(map)) {
        throw new ViewError('A map view needs a latitude and a longitude column');
    }
    check_keys(map, ['lat_field', 'lng_field', 'label_field'], 'map setting');
    const lat = group_column(columns, map.lat_field, 'Latitude', ['number']);
    const lng = group_column(columns, map.lng_field, 'Longitude', ['number']);
    if (lat.field === lng.field) {
        throw new ViewError('Map: pick different latitude and longitude columns');
    }
    return {
        lat_field: lat.field,
        lng_field: lng.field,
        label_field: title_column(columns, map.label_field, 'Label column')
    };
}

// The settings each view type has besides its filters, sort and hidden columns
const TYPE_SETTINGS: [string, (value: unknown, columns: ViewColumn[]) => unknown][] = [
    ['kanban', parse_kanban],
    ['chart', parse_chart],
    ['calendar', parse_calendar],
    ['map', parse_map]
];

/**
 * A view's settings from a request body, checked against the table's columns. With `current`
 * (an update), only the keys in the body change, and the result holds just those; a type
 * change needs its kanban or chart settings (in the body, or already on the view).
 */
export function parse_view_settings(
    body: unknown,
    columns: ViewColumn[],
    current?: ViewSettings
): Partial<ViewSettings> {
    if (!is_plain_object(body)) throw new ViewError('The body must be a JSON object');
    check_keys(body, SETTING_KEYS, 'view setting');
    const has = (k: string) => body[k] !== undefined;
    const out: Partial<ViewSettings> = {};

    if (!current || has('name')) out.name = parse_name(body.name);
    const type = has('type') ? body.type : current ? current.type : 'grid';
    if (!VIEW_TYPES.includes(type as ViewType)) {
        throw new ViewError(`type must be ${VIEW_TYPES.join(', ')}`);
    }
    if (!current || has('type')) out.type = type as ViewType;
    if (!current || has('filters')) out.filters = parse_filters(body.filters, columns);
    if (!current || has('sort')) out.sort = parse_sort(body.sort, columns);
    if (!current || has('hidden_fields')) {
        out.hidden_fields = parse_hidden(body.hidden_fields, columns);
    }

    // Only the settings of the view's type are kept
    const type_changed = !current || has('type');
    const o = out as Record<string, unknown>;
    TYPE_SETTINGS.forEach(([t, parse]) => {
        if (t === type) {
            if (type_changed || has(t)) o[t] = parse(has(t) ? body[t] : current?.[t], columns);
            return;
        }
        if (has(t) && body[t] !== null) {
            throw new ViewError(`${t} settings only go with type ${t}`);
        }
        if (type_changed) o[t] = null;
    });
    return out;
}

function escape_regexp(s: string) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The Mongo filter of a view's filters, as the grid builds it (WebFileManager.build_find_obj):
 * text `equals` is the whole value, `contains` a part of it, both case-sensitive. A filter on a
 * column that's since been deleted, or whose type changed so its value no longer fits, is left
 * out rather than matching nothing.
 */
export function view_filter_query(filters: ViewFilter[], columns: ViewColumn[]) {
    const parts: Record<string, unknown>[] = [];
    (filters || []).forEach(f => {
        const col = columns.find(c => c.field === f.field);
        if (!col || !filter_types(col.type).includes(f.type)) return;
        const value = filter_value(col, f.value);
        if (value === undefined) return;
        let cond: unknown;
        if (col.type === 'string') {
            const text = escape_regexp(String(value));
            cond = { $regex: f.type === 'equals' ? `^${text}$` : text };
        } else if (f.type === 'equals') {
            cond = value;
        } else {
            const op = {
                lessThan: '$lt',
                lessThanOrEqual: '$lte',
                greaterThan: '$gt',
                greaterThanOrEqual: '$gte'
            }[f.type];
            cond = { [op]: value };
        }
        parts.push({ [col.field]: cond });
    });
    if (parts.length === 0) return {};
    return { $and: parts };
}

/** The Mongo sort of a view: its column (row_num is the order rows were added), then _id. */
export function view_mongo_sort(sort: ViewSort | null, columns: ViewColumn[]) {
    const out: Record<string, 1 | -1> = {};
    if (sort) {
        const dir = sort.dir === 'desc' ? -1 : 1;
        if (sort.field === ROW_NUM) out.row_index = dir;
        else if (columns.some(c => c.field === sort.field && c.type !== 'link')) {
            out[sort.field] = dir;
        }
    }
    if (out._id === undefined) out._id = 1;
    return out;
}

// --- Kanban ---

/** The aggregation that lists a board's columns: the group column's values, with counts. */
export function kanban_groups_pipeline(filter: Record<string, unknown>, group_field: string) {
    return [
        { $match: filter },
        { $group: { _id: `$${group_field}`, count: { $sum: 1 } } },
        { $sort: { _id: 1 } },
        { $limit: VIEW_LIMITS.max_kanban_groups + 1 }
    ];
}

/** The Mongo filter of one board column: rows with that value (or empty, for null). */
export function kanban_group_filter(
    filter: Record<string, unknown>,
    group_field: string,
    value: unknown
) {
    const cond =
        value === null || value === undefined || value === ''
            ? { [group_field]: { $in: [null, ''] } }
            : { [group_field]: value };
    return Object.keys(filter).length > 0 ? { $and: [filter, cond] } : cond;
}

/** A board's columns from the groups aggregation: empty values together, first. */
export function kanban_groups(docs: { _id: unknown; count: number }[]) {
    const groups: { value: string | number | null; count: number }[] = [];
    let empty = 0;
    (docs || []).slice(0, VIEW_LIMITS.max_kanban_groups).forEach(d => {
        const v = d._id;
        if (v === null || v === undefined || v === '') empty += d.count;
        else if (typeof v === 'number') groups.push({ value: v, count: d.count });
        else groups.push({ value: String(v), count: d.count });
    });
    if (empty > 0) groups.unshift({ value: null, count: empty });
    return { groups, truncated: (docs || []).length > VIEW_LIMITS.max_kanban_groups };
}

// --- Charts ---

/**
 * The aggregation of a chart: one point per value of its column (per day, for a date column),
 * counting the rows or summing a number column. Bars and slices come largest first; a line's
 * points in the column's order.
 */
export function chart_pipeline(
    filter: Record<string, unknown>,
    chart: ChartSettings,
    columns: ViewColumn[]
) {
    const group = columns.find(c => c.field === chart.group_field);
    const key =
        group && group.type === 'date'
            ? // Per day; a value that isn't a date (from an old import) counts as empty
              {
                  $cond: [
                      { $eq: [{ $type: `$${chart.group_field}` }, 'date'] },
                      { $dateToString: { format: '%Y-%m-%d', date: `$${chart.group_field}` } },
                      null
                  ]
              }
            : `$${chart.group_field}`;
    const value =
        chart.agg === 'sum' && chart.value_field ? { $sum: `$${chart.value_field}` } : { $sum: 1 };
    const sort = chart.kind === 'line' ? { _id: 1 } : { value: -1, _id: 1 };
    return [
        { $match: filter },
        { $group: { _id: key, value } },
        { $sort: sort },
        { $limit: VIEW_LIMITS.max_chart_points + 1 }
    ];
}

/** The chart's points from its aggregation; an empty value is labelled "(empty)". */
export function chart_points(docs: { _id: unknown; value: number }[]) {
    const points = (docs || []).slice(0, VIEW_LIMITS.max_chart_points).map(d => ({
        label: d._id === null || d._id === undefined || d._id === '' ? '(empty)' : String(d._id),
        value: typeof d.value === 'number' && isFinite(d.value) ? d.value : 0
    }));
    return { points, truncated: (docs || []).length > VIEW_LIMITS.max_chart_points };
}

// --- Calendars (#211) ---

const DAY_MS = 24 * 60 * 60 * 1000;
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

function utc_day(value: unknown, what: string) {
    const m = typeof value === 'string' ? DAY.exec(value) : null;
    if (m) {
        const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
        if (d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3]) return d;
    }
    throw new ViewError(`${what} must be a day as YYYY-MM-DD`);
}

/**
 * The days a calendar reads: `from` up to but not including `to` (YYYY-MM-DD, in UTC like the
 * stored dates). Without them, the current month.
 */
export function parse_calendar_range(from: unknown, to: unknown, now: number) {
    const none = (v: unknown) => v === undefined || v === null || v === '';
    if (none(from) && none(to)) {
        const d = new Date(now);
        return {
            from: new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)),
            to: new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))
        };
    }
    if (none(from) || none(to)) throw new ViewError('Give both from and to, or neither');
    const start = utc_day(from, 'from');
    const end = utc_day(to, 'to');
    if (end.getTime() <= start.getTime()) throw new ViewError('to must be after from');
    if ((end.getTime() - start.getTime()) / DAY_MS > VIEW_LIMITS.max_calendar_days) {
        throw new ViewError(`A calendar reads at most ${VIEW_LIMITS.max_calendar_days} days`);
    }
    return { from: start, to: end };
}

function and_filter(filter: Record<string, unknown>, conds: Record<string, unknown>[]) {
    const parts = Object.keys(filter).length > 0 ? [filter, ...conds] : conds;
    return parts.length === 1 ? parts[0] : { $and: parts };
}

/** The Mongo filter of a calendar: the view's rows whose date falls in the range. */
export function calendar_filter(
    filter: Record<string, unknown>,
    date_field: string,
    range: { from: Date; to: Date }
) {
    return and_filter(filter, [{ [date_field]: { $gte: range.from, $lt: range.to } }]);
}

// A row's title or label: its column's value, or "Row <n>"
function row_title(row: any, field: string | null, columns: ViewColumn[]) {
    const col = field ? columns.find(c => c.field === field) : null;
    const v = col && ['string', 'number'].includes(col.type) ? row[col.field] : null;
    if (v === null || v === undefined || v === '' || typeof v === 'object') {
        return row.row_index ? `Row ${row.row_index}` : 'Row';
    }
    return String(v);
}

/**
 * A calendar's events from its rows (read in date order): the row's id, its day (UTC), its time
 * when it isn't midnight, and its title.
 */
export function calendar_events(rows: any[], calendar: CalendarSettings, columns: ViewColumn[]) {
    const events: { _id: string; date: string; time: string | null; title: string }[] = [];
    (rows || []).slice(0, VIEW_LIMITS.max_calendar_rows).forEach(row => {
        const d = row[calendar.date_field];
        if (!(d instanceof Date) || isNaN(d.getTime())) return;
        const iso = d.toISOString();
        events.push({
            _id: String(row._id),
            date: iso.slice(0, 10),
            time: iso.slice(11, 23) === '00:00:00.000' ? null : iso.slice(11, 16),
            title: row_title(row, calendar.title_field, columns)
        });
    });
    return { events, truncated: (rows || []).length > VIEW_LIMITS.max_calendar_rows };
}

// --- Maps (#211) ---

/** The Mongo filter of a map: the view's rows with a latitude and longitude in range. */
export function map_filter(filter: Record<string, unknown>, map: MapSettings) {
    // A range on numbers matches only numbers, so text and empty cells are left out
    return and_filter(filter, [
        { [map.lat_field]: { $gte: -90, $lte: 90 } },
        { [map.lng_field]: { $gte: -180, $lte: 180 } }
    ]);
}

/** A map's points from its rows: the row's id, latitude, longitude and label. */
export function map_points(rows: any[], map: MapSettings, columns: ViewColumn[]) {
    const points: { _id: string; lat: number; lng: number; label: string }[] = [];
    (rows || []).slice(0, VIEW_LIMITS.max_map_points).forEach(row => {
        const lat = row[map.lat_field];
        const lng = row[map.lng_field];
        if (typeof lat !== 'number' || typeof lng !== 'number') return;
        if (!isFinite(lat) || !isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return;
        points.push({
            _id: String(row._id),
            lat,
            lng,
            label: row_title(row, map.label_field, columns)
        });
    });
    return { points, truncated: (rows || []).length > VIEW_LIMITS.max_map_points };
}

/** Checks that a saved view's columns are still there, for its kanban, chart, calendar or map. */
export function assert_view_columns(view: ViewSettings, columns: ViewColumn[]) {
    if (view.type === 'kanban' && view.kanban) {
        const col = columns.find(c => c.field === view.kanban.group_field);
        if (!col || !['string', 'number'].includes(col.type)) {
            throw new ViewError("This view's group column was deleted or changed; edit the view");
        }
    }
    if (view.type === 'chart' && view.chart) {
        const col = columns.find(c => c.field === view.chart.group_field);
        if (!col || col.type === 'link') {
            throw new ViewError("This chart's column was deleted or changed; edit the view");
        }
        if (view.chart.agg === 'sum') {
            const v = columns.find(c => c.field === view.chart.value_field);
            if (!v || v.type !== 'number') {
                throw new ViewError(
                    "This chart's number column was deleted or changed; edit the view"
                );
            }
        }
    }
    if (view.type === 'calendar' && view.calendar) {
        const col = columns.find(c => c.field === view.calendar.date_field);
        if (!col || col.type !== 'date') {
            throw new ViewError(
                "This calendar's date column was deleted or changed; edit the view"
            );
        }
    }
    if (view.type === 'map' && view.map) {
        const ok = (field: string) => columns.some(c => c.field === field && c.type === 'number');
        if (!ok(view.map.lat_field) || !ok(view.map.lng_field)) {
            throw new ViewError(
                "This map's latitude or longitude column was deleted or changed; edit the view"
            );
        }
    }
}
