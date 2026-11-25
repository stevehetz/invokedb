import { HttpException } from '@nestjs/common';
import {
    MAX_LINKS_PER_CELL,
    assert_link_settings,
    coerce_link_value,
    collect_link_ids,
    expand_link_value,
    is_link_column,
    link_display_column,
    link_label,
    missing_link_ids,
    new_link_ids,
    normalize_link_value,
    parse_expand
} from './link';

const A = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const B = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const C = 'cccccccccccccccccccccccc';

function status_of(fn: () => unknown) {
    try {
        fn();
    } catch (ex) {
        return ex instanceof HttpException ? ex.getStatus() : 'not http';
    }
    return null;
}

describe('normalize_link_value', () => {
    it('is null for nothing', () => {
        expect(normalize_link_value(undefined)).toBeNull();
        expect(normalize_link_value(null)).toBeNull();
        expect(normalize_link_value('')).toBeNull();
        expect(normalize_link_value([])).toBeNull();
        expect(normalize_link_value([' ', ''])).toBeNull();
    });

    it('takes an id, an array, a comma-separated string and expanded rows', () => {
        expect(normalize_link_value(A)).toEqual([A]);
        expect(normalize_link_value([A, B])).toEqual([A, B]);
        expect(normalize_link_value(`${A}, ${B}`)).toEqual([A, B]);
        expect(normalize_link_value([{ _id: A, Name: 'x' }, B])).toEqual([A, B]);
        expect(normalize_link_value({ _id: C })).toEqual([C]);
    });

    it('lowercases and drops repeats, keeping the order', () => {
        expect(normalize_link_value([B, A.toUpperCase(), B, A])).toEqual([B, A]);
    });

    it('refuses anything that is not a row id', () => {
        expect(status_of(() => normalize_link_value('alice'))).toBe(400);
        expect(status_of(() => normalize_link_value([A, 'x']))).toBe(400);
        expect(status_of(() => normalize_link_value(42))).toBe(400);
        expect(status_of(() => normalize_link_value(true))).toBe(400);
        expect(status_of(() => normalize_link_value([{ $gt: '' }]))).toBe(400);
        expect(status_of(() => normalize_link_value([[A]]))).toBe(400);
        expect(status_of(() => normalize_link_value({ _id: { $ne: null } }))).toBe(400);
    });

    it(`allows at most ${MAX_LINKS_PER_CELL} rows`, () => {
        const ids = Array.from({ length: MAX_LINKS_PER_CELL + 1 }, (_, i) =>
            i.toString(16).padStart(24, '0')
        );
        expect(normalize_link_value(ids.slice(0, MAX_LINKS_PER_CELL))).toHaveLength(
            MAX_LINKS_PER_CELL
        );
        expect(status_of(() => normalize_link_value(ids))).toBe(400);
    });
});

describe('coerce_link_value', () => {
    it('keeps the ids of a value and drops the rest, without throwing', () => {
        expect(coerce_link_value(`${A},nope,${B}`)).toEqual([A, B]);
        expect(coerce_link_value([A, 3, null, A])).toEqual([A]);
        expect(coerce_link_value('alice')).toBeNull();
        expect(coerce_link_value(12)).toBeNull();
        expect(coerce_link_value({ _id: A })).toBeNull();
    });
});

describe('assert_link_settings', () => {
    it('needs a table id', () => {
        expect(status_of(() => assert_link_settings({ col_type: 'link' }))).toBe(400);
        expect(status_of(() => assert_link_settings({ link_table_id: 'abc' }))).toBe(400);
        expect(status_of(() => assert_link_settings({ link_table_id: 0 }))).toBe(400);
        expect(status_of(() => assert_link_settings({ link_table_id: 1.5 }))).toBe(400);
        expect(status_of(() => assert_link_settings({ link_table_id: { $gt: 0 } }))).toBe(400);
    });

    it('takes a numeric or string id and an optional field', () => {
        expect(assert_link_settings({ link_table_id: 7 })).toEqual({
            table_id: 7,
            display_field: ''
        });
        expect(assert_link_settings({ link_table_id: '7', link_display_field: 'b' })).toEqual({
            table_id: 7,
            display_field: 'b'
        });
    });

    it('refuses a display field that is not a field name', () => {
        expect(
            status_of(() => assert_link_settings({ link_table_id: 7, link_display_field: 3 }))
        ).toBe(400);
        expect(
            status_of(() => assert_link_settings({ link_table_id: 7, link_display_field: '$x' }))
        ).toBe(400);
    });
});

describe('parse_expand', () => {
    const columns = [
        { name: 'Contact', col: { col_type: 'link', link_table_id: 2 } },
        { name: 'Task', col: { col_type: 'string' } },
        { name: 'Owner', col: { col_type: 'link', link_table_id: 3 } }
    ];

    it('is nothing when not asked', () => {
        expect(parse_expand(undefined, columns)).toEqual([]);
        expect(parse_expand('', columns)).toEqual([]);
    });

    it('takes comma-separated and repeated names, once each', () => {
        expect(parse_expand('Contact', columns).map(c => c.name)).toEqual(['Contact']);
        expect(parse_expand('Owner, Contact,Owner', columns).map(c => c.name)).toEqual([
            'Owner',
            'Contact'
        ]);
        expect(parse_expand(['Contact', 'Owner'], columns).map(c => c.name)).toEqual([
            'Contact',
            'Owner'
        ]);
    });

    it('refuses unknown and non-link columns', () => {
        expect(status_of(() => parse_expand('Nope', columns))).toBe(400);
        expect(status_of(() => parse_expand('Task', columns))).toBe(400);
        expect(status_of(() => parse_expand({ a: 1 }, columns))).toBe(400);
    });
});

describe('helpers', () => {
    it('is_link_column', () => {
        expect(is_link_column({ col_type: 'link' })).toBe(true);
        expect(is_link_column({ col_type: 'string' })).toBe(false);
        expect(is_link_column(null)).toBe(false);
    });

    it('collect_link_ids takes each id once and skips non-cells', () => {
        expect(collect_link_ids([[A, B], null, 'x', [B, C, 'nope']])).toEqual([A, B, C]);
    });

    it('missing_link_ids', () => {
        expect(missing_link_ids([A, B, C], [B.toUpperCase()])).toEqual([A, C]);
    });

    it('new_link_ids leaves out ids already stored in the cell', () => {
        expect(new_link_ids([A, B], [A])).toEqual([B]);
        expect(new_link_ids([A, B], [A.toUpperCase(), B])).toEqual([]);
        expect(new_link_ids([A], null)).toEqual([A]);
        expect(new_link_ids([A], 'not a cell')).toEqual([A]);
        expect(new_link_ids(null, [A])).toEqual([]);
    });

    it('link_display_column is the named live column, else the first', () => {
        const cols = [
            { field: 'a', headerName: 'Name' },
            { field: 'b', headerName: 'Gone', deleted: true },
            { field: 'c', headerName: 'Email' }
        ];
        expect(link_display_column(cols, 'c').field).toBe('c');
        expect(link_display_column(cols, 'b').field).toBe('a');
        expect(link_display_column(cols, '').field).toBe('a');
        expect(link_display_column([], 'a')).toBeNull();
    });

    it('link_label is the display value, else the id', () => {
        expect(link_label({ _id: A, a: 'Ada' }, 'a')).toBe('Ada');
        expect(link_label({ _id: A, a: 12 }, 'a')).toBe('12');
        expect(link_label({ _id: A, a: '' }, 'a')).toBe(A);
        expect(link_label({ _id: A }, null)).toBe(A);
    });

    it('expand_link_value keeps the order and leaves out rows that are gone', () => {
        const rows = new Map([
            [A, { _id: A, Name: 'Ada' }],
            [C, { _id: C, Name: 'Cy' }]
        ]);
        expect(expand_link_value([C, B, A], rows)).toEqual([
            { _id: C, Name: 'Cy' },
            { _id: A, Name: 'Ada' }
        ]);
        expect(expand_link_value(null, rows)).toBeNull();
    });
});
