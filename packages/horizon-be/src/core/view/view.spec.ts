import {
    VIEW_LIMITS,
    ViewColumn,
    ViewError,
    ViewSettings,
    assert_view_columns,
    chart_pipeline,
    chart_points,
    is_view_id,
    kanban_group_filter,
    kanban_groups,
    kanban_groups_pipeline,
    new_view_id,
    parse_view_settings,
    view_columns,
    view_filter_query,
    view_mongo_sort
} from './view';

const COLUMNS: ViewColumn[] = [
    { field: 'a', name: 'Task', type: 'string' },
    { field: 'b', name: 'Status', type: 'string' },
    { field: 'c', name: 'Hours', type: 'number' },
    { field: 'd', name: 'Due', type: 'date' },
    { field: 'e', name: 'Contact', type: 'link' }
];

const parse = (body: any, current?: ViewSettings) =>
    parse_view_settings(body, COLUMNS, current) as ViewSettings;

const bad = (body: any, message: RegExp, current?: ViewSettings) => {
    expect(() => parse_view_settings(body, COLUMNS, current)).toThrow(ViewError);
    expect(() => parse_view_settings(body, COLUMNS, current)).toThrow(message);
};

describe('view ids', () => {
    it('are view_ and 24 hex characters', () => {
        const id = new_view_id();
        expect(is_view_id(id)).toBe(true);
        expect(new_view_id()).not.toBe(id);
        expect(is_view_id('view_123')).toBe(false);
        expect(is_view_id('form_' + 'a'.repeat(24))).toBe(false);
        expect(is_view_id({})).toBe(false);
    });
});

describe('view_columns', () => {
    it('keeps live columns in grid order, with their types', () => {
        expect(
            view_columns([
                { field: 'b', headerName: 'B', order: 2, col_type: 'number' },
                { field: 'a', headerName: 'A', order: 1 },
                { field: 'z', headerName: 'gone', order: 0, deleted: true },
                { field: 'c', headerName: 'C', order: 3, col_type: 'link' },
                { headerName: 'no field', order: 4 }
            ])
        ).toEqual([
            { field: 'a', name: 'A', type: 'string' },
            { field: 'b', name: 'B', type: 'number' },
            { field: 'c', name: 'C', type: 'link' }
        ]);
    });
});

describe('parse_view_settings: a new view', () => {
    it('makes a grid view with defaults', () => {
        expect(parse({ name: '  Open tasks ' })).toEqual({
            name: 'Open tasks',
            type: 'grid',
            filters: [],
            sort: null,
            hidden_fields: [],
            kanban: null,
            chart: null
        });
    });

    it('keeps filters, sort and hidden columns', () => {
        const v = parse({
            name: 'Mine',
            file_id: 3,
            filters: [
                { field: 'b', type: 'contains', value: 'do' },
                { field: 'c', type: 'greaterThan', value: 2 },
                { field: 'd', type: 'lessThanOrEqual', value: '2026-12-01' }
            ],
            sort: { field: 'c', dir: 'desc' },
            hidden_fields: ['d', 'd', 'a']
        });
        expect(v.filters).toEqual([
            { field: 'b', type: 'contains', value: 'do' },
            { field: 'c', type: 'greaterThan', value: '2' },
            { field: 'd', type: 'lessThanOrEqual', value: '2026-12-01' }
        ]);
        expect(v.sort).toEqual({ field: 'c', dir: 'desc' });
        expect(v.hidden_fields).toEqual(['d', 'a']);
        expect(parse({ name: 'x', sort: { field: 'row_num' } }).sort).toEqual({
            field: 'row_num',
            dir: 'asc'
        });
    });

    it('makes kanban and chart views', () => {
        const k = parse({ name: 'Board', type: 'kanban', kanban: { group_field: 'b' } });
        expect(k.kanban).toEqual({ group_field: 'b' });
        expect(k.chart).toBeNull();
        const c = parse({
            name: 'Hours',
            type: 'chart',
            chart: { kind: 'pie', group_field: 'b', agg: 'sum', value_field: 'c' }
        });
        expect(c.chart).toEqual({ kind: 'pie', group_field: 'b', agg: 'sum', value_field: 'c' });
        expect(c.kanban).toBeNull();
        expect(parse({ name: 'n', type: 'chart', chart: { group_field: 'd' } }).chart).toEqual({
            kind: 'bar',
            group_field: 'd',
            agg: 'count',
            value_field: null
        });
    });

    it('refuses bad settings', () => {
        bad(null, /JSON object/);
        bad({}, /name/);
        bad({ name: 'x'.repeat(VIEW_LIMITS.max_name_length + 1) }, /at most/);
        bad({ name: 'x', account_id: 2 }, /Unknown view setting: account_id/);
        bad({ name: 'x', type: 'calendar' }, /type must be/);
        bad({ name: 'x', filters: {} }, /must be a list/);
        bad(
            { name: 'x', filters: [{ field: 'zz', type: 'equals', value: '1' }] },
            /unknown column/
        );
        bad({ name: 'x', filters: [{ field: 'a', type: 'lessThan', value: '1' }] }, /takes/);
        bad({ name: 'x', filters: [{ field: 'c', type: 'contains', value: '1' }] }, /takes/);
        bad({ name: 'x', filters: [{ field: 'c', type: 'equals', value: 'abc' }] }, /number/);
        bad({ name: 'x', filters: [{ field: 'd', type: 'equals', value: 'soon' }] }, /date/);
        bad({ name: 'x', filters: [{ field: 'a', type: 'equals', value: ' ' }] }, /value/);
        bad(
            { name: 'x', filters: [{ field: 'e', type: 'equals', value: 'q' }] },
            /can't be filtered/
        );
        bad(
            { name: 'x', filters: [{ field: 'a', type: 'equals', value: 'q', $where: 1 }] },
            /Unknown filter/
        );
        bad(
            {
                name: 'x',
                filters: [
                    { field: 'a', type: 'equals', value: 'q' },
                    { field: 'a', type: 'contains', value: 'r' }
                ]
            },
            /twice/
        );
        bad({ name: 'x', sort: { field: 'c', dir: 'up' } }, /asc or desc/);
        bad({ name: 'x', sort: { field: 'e' } }, /can't be sorted/);
        bad({ name: 'x', hidden_fields: ['a', 'b', 'c', 'd', 'e'] }, /at least one column/);
        bad({ name: 'x', hidden_fields: ['q'] }, /unknown column/);
        bad({ name: 'x', type: 'kanban' }, /group by/);
        bad({ name: 'x', type: 'kanban', kanban: { group_field: 'd' } }, /date column/);
        bad({ name: 'x', type: 'kanban', kanban: { group_field: 'e' } }, /link column/);
        bad({ name: 'x', type: 'chart', chart: { group_field: 'e' } }, /link column/);
        bad({ name: 'x', type: 'chart', chart: { group_field: 'b', kind: 'radar' } }, /kind/);
        bad({ name: 'x', type: 'chart', chart: { group_field: 'b', agg: 'avg' } }, /agg/);
        bad({ name: 'x', type: 'chart', chart: { group_field: 'b', agg: 'sum' } }, /Sum of/);
        bad(
            { name: 'x', type: 'chart', chart: { group_field: 'b', agg: 'sum', value_field: 'a' } },
            /string column/
        );
        bad(
            { name: 'x', type: 'chart', chart: { group_field: 'b', value_field: 'c' } },
            /only goes with agg sum/
        );
        bad({ name: 'x', kanban: { group_field: 'b' } }, /only go with type kanban/);
        bad({ name: 'x', type: 'kanban', kanban: { group_field: 'b' }, chart: {} }, /only go/);
    });
});

describe('parse_view_settings: an update', () => {
    const current = parse({
        name: 'Board',
        type: 'kanban',
        kanban: { group_field: 'b' },
        filters: [{ field: 'a', type: 'contains', value: 'x' }]
    });

    it('changes only the given keys', () => {
        expect(parse_view_settings({ name: 'Renamed' }, COLUMNS, current)).toEqual({
            name: 'Renamed'
        });
        expect(parse_view_settings({}, COLUMNS, current)).toEqual({});
        expect(parse_view_settings({ kanban: { group_field: 'c' } }, COLUMNS, current)).toEqual({
            kanban: { group_field: 'c' }
        });
        expect(parse_view_settings({ filters: [] }, COLUMNS, current)).toEqual({ filters: [] });
    });

    it('drops the old type settings when the type changes', () => {
        expect(
            parse_view_settings({ type: 'chart', chart: { group_field: 'b' } }, COLUMNS, current)
        ).toEqual({
            type: 'chart',
            chart: { kind: 'bar', group_field: 'b', agg: 'count', value_field: null },
            kanban: null
        });
        expect(parse_view_settings({ type: 'grid' }, COLUMNS, current)).toEqual({
            type: 'grid',
            kanban: null,
            chart: null
        });
        // Back to kanban with the settings it already has
        expect(parse_view_settings({ type: 'kanban' }, COLUMNS, current)).toEqual({
            type: 'kanban',
            kanban: { group_field: 'b' },
            chart: null
        });
        bad({ type: 'chart' }, /needs a column/, current);
        bad({ name: '' }, /name/, current);
    });
});

describe('view_filter_query', () => {
    it('builds the same conditions as the grid', () => {
        expect(
            view_filter_query(
                [
                    { field: 'a', type: 'equals', value: 'a.b' },
                    { field: 'b', type: 'contains', value: '(x' },
                    { field: 'c', type: 'greaterThanOrEqual', value: '2.5' },
                    { field: 'd', type: 'equals', value: '2026-12-01' }
                ],
                COLUMNS
            )
        ).toEqual({
            $and: [
                { a: { $regex: '^a\\.b$' } },
                { b: { $regex: '\\(x' } },
                { c: { $gte: 2.5 } },
                { d: new Date(Date.UTC(2026, 11, 1)) }
            ]
        });
    });

    it('leaves out filters on deleted or changed columns', () => {
        expect(view_filter_query([], COLUMNS)).toEqual({});
        expect(
            view_filter_query(
                [
                    { field: 'zz', type: 'equals', value: '1' },
                    { field: 'a', type: 'lessThan', value: '1' },
                    { field: 'c', type: 'equals', value: 'abc' }
                ],
                COLUMNS
            )
        ).toEqual({});
    });
});

describe('view_mongo_sort', () => {
    it('sorts by the column, then _id', () => {
        expect(view_mongo_sort(null, COLUMNS)).toEqual({ _id: 1 });
        expect(view_mongo_sort({ field: 'c', dir: 'desc' }, COLUMNS)).toEqual({ c: -1, _id: 1 });
        expect(view_mongo_sort({ field: 'row_num', dir: 'desc' }, COLUMNS)).toEqual({
            row_index: -1,
            _id: 1
        });
        expect(view_mongo_sort({ field: 'gone', dir: 'asc' }, COLUMNS)).toEqual({ _id: 1 });
    });
});

describe('kanban', () => {
    it('groups by the column, with the view filter', () => {
        const filter = { $and: [{ a: 1 }] };
        expect(kanban_groups_pipeline(filter, 'b')).toEqual([
            { $match: filter },
            { $group: { _id: '$b', count: { $sum: 1 } } },
            { $sort: { _id: 1 } },
            { $limit: VIEW_LIMITS.max_kanban_groups + 1 }
        ]);
        expect(kanban_group_filter({}, 'b', 'Done')).toEqual({ b: 'Done' });
        expect(kanban_group_filter(filter, 'b', null)).toEqual({
            $and: [filter, { b: { $in: [null, ''] } }]
        });
    });

    it('puts empty values together, first, and caps the columns', () => {
        expect(
            kanban_groups([
                { _id: null, count: 1 },
                { _id: '', count: 2 },
                { _id: 'Done', count: 3 },
                { _id: 4, count: 1 }
            ])
        ).toEqual({
            groups: [
                { value: null, count: 3 },
                { value: 'Done', count: 3 },
                { value: 4, count: 1 }
            ],
            truncated: false
        });
        const many = Array.from({ length: VIEW_LIMITS.max_kanban_groups + 1 }, (_, i) => ({
            _id: `v${i}`,
            count: 1
        }));
        const res = kanban_groups(many);
        expect(res.groups.length).toBe(VIEW_LIMITS.max_kanban_groups);
        expect(res.truncated).toBe(true);
    });
});

describe('charts', () => {
    it('counts or sums per value', () => {
        expect(
            chart_pipeline(
                {},
                { kind: 'bar', group_field: 'b', agg: 'sum', value_field: 'c' },
                COLUMNS
            )
        ).toEqual([
            { $match: {} },
            { $group: { _id: '$b', value: { $sum: '$c' } } },
            { $sort: { value: -1, _id: 1 } },
            { $limit: VIEW_LIMITS.max_chart_points + 1 }
        ]);
        const line = chart_pipeline(
            {},
            { kind: 'line', group_field: 'd', agg: 'count', value_field: null },
            COLUMNS
        );
        expect(line[1]).toEqual({
            $group: {
                _id: {
                    $cond: [
                        { $eq: [{ $type: '$d' }, 'date'] },
                        { $dateToString: { format: '%Y-%m-%d', date: '$d' } },
                        null
                    ]
                },
                value: { $sum: 1 }
            }
        });
        expect(line[2]).toEqual({ $sort: { _id: 1 } });
    });

    it('labels the points', () => {
        expect(
            chart_points([
                { _id: 'Done', value: 2 },
                { _id: null, value: 1 },
                { _id: 3, value: NaN }
            ])
        ).toEqual({
            points: [
                { label: 'Done', value: 2 },
                { label: '(empty)', value: 1 },
                { label: '3', value: 0 }
            ],
            truncated: false
        });
    });
});

describe('assert_view_columns', () => {
    it('refuses a view whose columns are gone or changed', () => {
        const k = parse({ name: 'k', type: 'kanban', kanban: { group_field: 'b' } });
        expect(() => assert_view_columns(k, COLUMNS)).not.toThrow();
        expect(() =>
            assert_view_columns(
                k,
                COLUMNS.filter(c => c.field !== 'b')
            )
        ).toThrow(/group column/);
        const c = parse({
            name: 'c',
            type: 'chart',
            chart: { group_field: 'b', agg: 'sum', value_field: 'c' }
        });
        expect(() => assert_view_columns(c, COLUMNS)).not.toThrow();
        const changed = COLUMNS.map(col =>
            col.field === 'c' ? { ...col, type: 'string' as const } : col
        );
        expect(() => assert_view_columns(c, changed)).toThrow(/number column/);
        expect(() => assert_view_columns(parse({ name: 'g' }), [])).not.toThrow();
    });
});
