import {
    DASHBOARD_LIMITS,
    DashboardError,
    Tile,
    check_tile,
    is_dashboard_id,
    is_share_token,
    new_dashboard_id,
    new_share_token,
    parse_dashboard_settings,
    public_tile,
    stat_pipeline,
    stat_value,
    table_tile_columns,
    table_tile_rows
} from './dashboard';
import { ViewColumn } from '../view/view';

const COLUMNS: ViewColumn[] = [
    { field: 'a', name: 'Task', type: 'string' },
    { field: 'b', name: 'Hours', type: 'number' },
    { field: 'c', name: 'Due', type: 'date' },
    { field: 'd', name: 'Contact', type: 'link' }
];
const VIEW = 'view_' + '1'.repeat(24);

function tile(t: Partial<Tile> = {}): Tile {
    return {
        id: 'tile_000000000001',
        type: 'table',
        title: '',
        file_id: 11,
        view_id: null,
        wide: false,
        limit: 10,
        agg: null,
        value_field: null,
        ...t
    };
}

describe('dashboard ids and tokens', () => {
    it('makes ids and share tokens it recognises', () => {
        expect(is_dashboard_id(new_dashboard_id())).toBe(true);
        expect(is_share_token(new_share_token())).toBe(true);
        expect(is_share_token(new_dashboard_id())).toBe(false);
        expect(is_dashboard_id('dash_x')).toBe(false);
        expect(new_share_token()).not.toBe(new_share_token());
    });
});

describe('parse_dashboard_settings', () => {
    it('reads a name and chart, table and stat tiles with defaults', () => {
        const out = parse_dashboard_settings({
            name: '  Sales ',
            tiles: [
                { type: 'chart', file_id: 11, view_id: VIEW, title: ' By status ' },
                { type: 'table', file_id: '11', wide: true },
                { type: 'stat', file_id: 11 },
                { type: 'stat', file_id: 11, agg: 'sum', value_field: 'b', view_id: VIEW }
            ]
        });
        expect(out.name).toBe('Sales');
        const [chart, table, count, sum] = out.tiles;
        expect(chart).toMatchObject({ type: 'chart', title: 'By status', view_id: VIEW });
        expect(table).toMatchObject({ file_id: 11, wide: true, limit: 10, view_id: null });
        expect(count).toMatchObject({ agg: 'count', value_field: null, limit: null });
        expect(sum).toMatchObject({ agg: 'sum', value_field: 'b' });
        expect(new Set(out.tiles.map(t => t.id)).size).toBe(4);
        out.tiles.forEach(t => expect(t.id).toMatch(/^tile_[0-9a-f]{12}$/));
    });

    it('keeps a tile id it was given, but not a repeated one', () => {
        const id = 'tile_abcdefabcdef';
        const out = parse_dashboard_settings({
            name: 'x',
            tiles: [
                { id, type: 'stat', file_id: 1 },
                { id, type: 'stat', file_id: 1 }
            ]
        });
        expect(out.tiles[0].id).toBe(id);
        expect(out.tiles[1].id).not.toBe(id);
    });

    it('changes only the keys of an update', () => {
        expect(parse_dashboard_settings({ name: 'New' }, true)).toEqual({ name: 'New' });
        expect(parse_dashboard_settings({}, true)).toEqual({});
    });

    it.each([
        ['no name', { name: ' ' }],
        ['a long name', { name: 'x'.repeat(DASHBOARD_LIMITS.max_name_length + 1) }],
        ['an unknown setting', { name: 'x', account_id: 2 }],
        ['tiles not a list', { name: 'x', tiles: {} }],
        [
            'too many tiles',
            {
                name: 'x',
                tiles: Array(DASHBOARD_LIMITS.max_tiles + 1).fill({ type: 'stat', file_id: 1 })
            }
        ],
        ['an unknown type', { name: 'x', tiles: [{ type: 'map', file_id: 1 }] }],
        ['no table', { name: 'x', tiles: [{ type: 'stat' }] }],
        ['a bad table', { name: 'x', tiles: [{ type: 'stat', file_id: 'abc' }] }],
        ['a chart without a view', { name: 'x', tiles: [{ type: 'chart', file_id: 1 }] }],
        ['a bad view id', { name: 'x', tiles: [{ type: 'table', file_id: 1, view_id: '$x' }] }],
        ['a bad limit', { name: 'x', tiles: [{ type: 'table', file_id: 1, limit: 51 }] }],
        ['a limit on a stat', { name: 'x', tiles: [{ type: 'stat', file_id: 1, limit: 5 }] }],
        ['an unknown agg', { name: 'x', tiles: [{ type: 'stat', file_id: 1, agg: 'median' }] }],
        [
            'a sum without a column',
            { name: 'x', tiles: [{ type: 'stat', file_id: 1, agg: 'sum' }] }
        ],
        [
            'a column with count',
            { name: 'x', tiles: [{ type: 'stat', file_id: 1, value_field: 'b' }] }
        ],
        ['an agg on a table', { name: 'x', tiles: [{ type: 'table', file_id: 1, agg: 'sum' }] }],
        ['an unknown tile key', { name: 'x', tiles: [{ type: 'stat', file_id: 1, $where: 1 }] }],
        ['a title not text', { name: 'x', tiles: [{ type: 'stat', file_id: 1, title: 5 }] }],
        ['wide not a boolean', { name: 'x', tiles: [{ type: 'stat', file_id: 1, wide: 'yes' }] }]
    ])('refuses %s', (_name, body) => {
        expect(() => parse_dashboard_settings(body)).toThrow(DashboardError);
    });
});

describe('check_tile', () => {
    it('accepts a tile whose view and column fit', () => {
        expect(() =>
            check_tile(tile({ type: 'chart', view_id: VIEW }), COLUMNS, {
                file_id: 11,
                type: 'chart'
            })
        ).not.toThrow();
        expect(() =>
            check_tile(tile({ type: 'stat', agg: 'avg', value_field: 'b' }), COLUMNS, null)
        ).not.toThrow();
    });

    it('refuses a deleted view, a view of another table, or a chart tile on a grid view', () => {
        expect(() => check_tile(tile({ view_id: VIEW }), COLUMNS, null)).toThrow(/deleted/);
        expect(() =>
            check_tile(tile({ view_id: VIEW }), COLUMNS, { file_id: 12, type: 'grid' })
        ).toThrow(/deleted/);
        expect(() =>
            check_tile(tile({ type: 'chart', view_id: VIEW }), COLUMNS, {
                file_id: 11,
                type: 'grid'
            })
        ).toThrow(/chart view/);
    });

    it('refuses a stat over a column that is gone or not a number', () => {
        const stat = (value_field: string) => tile({ type: 'stat', agg: 'sum', value_field });
        expect(() => check_tile(stat('a'), COLUMNS, null)).toThrow(DashboardError);
        expect(() => check_tile(stat('z'), COLUMNS, null)).toThrow(DashboardError);
    });

    it('refuses a table tile with nothing to show', () => {
        const only_link = [COLUMNS[3]];
        expect(() => check_tile(tile(), only_link, null)).toThrow(/no columns/);
    });
});

describe('stat tiles', () => {
    it('counts, or applies the agg to the column', () => {
        expect(stat_pipeline({}, 'count', null)).toEqual([
            { $match: {} },
            { $group: { _id: null, value: { $sum: 1 } } }
        ]);
        expect(stat_pipeline({ b: 1 }, 'avg', 'b')[1]).toEqual({
            $group: { _id: null, value: { $avg: '$b' } }
        });
    });

    it('answers 0 for no rows counted or summed, null for an average of none', () => {
        expect(stat_value([], 'count')).toBe(0);
        expect(stat_value([], 'sum')).toBe(0);
        expect(stat_value([], 'avg')).toBeNull();
        expect(stat_value([{ value: null }], 'max')).toBeNull();
        expect(stat_value([{ value: 4.5 }], 'sum')).toBe(4.5);
    });
});

describe('table tiles', () => {
    it("shows the view's shown columns, never links", () => {
        expect(table_tile_columns(COLUMNS, null).map(c => c.field)).toEqual(['a', 'b', 'c']);
        expect(
            table_tile_columns(COLUMNS, { file_id: 11, type: 'grid', hidden_fields: ['b'] }).map(
                c => c.field
            )
        ).toEqual(['a', 'c']);
    });

    it("keeps only the shown columns' values, without row ids", () => {
        const shown = table_tile_columns(COLUMNS, null);
        expect(
            table_tile_rows([{ _id: 'x', row_index: 3, a: 'Write', b: 2, d: ['y'] }], shown)
        ).toEqual([{ a: 'Write', b: 2, c: null }]);
    });
});

describe('public_tile', () => {
    it("leaves out the tile's table and view", () => {
        const out = public_tile({ ...tile({ view_id: VIEW }), data: { value: 1 }, error: null });
        expect(out).not.toHaveProperty('file_id');
        expect(out).not.toHaveProperty('view_id');
        expect(out).toMatchObject({ type: 'table', data: { value: 1 } });
    });
});
