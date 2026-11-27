import { HttpException } from '@nestjs/common';
import { MAX_LINKS_PER_CELL } from './link';
import {
    MatchIndex,
    add_to_counts,
    assert_source_columns,
    assert_target_column,
    columns_match_kind,
    empty_counts,
    is_empty_link_cell,
    match_key,
    match_kind,
    match_row,
    parse_link_match_body
} from './link-match';

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

describe('match_kind', () => {
    it('compares numbers and dates as such, anything else as text', () => {
        expect(match_kind('string', 'string')).toBe('string');
        expect(match_kind('number', 'number')).toBe('number');
        expect(match_kind('number', 'string')).toBe('number');
        expect(match_kind('date', 'date')).toBe('date');
        expect(match_kind('string', 'date')).toBe('date');
        expect(match_kind('number', 'date')).toBe('string');
        expect(match_kind(undefined, 'number')).toBe('number');
    });
});

describe('match_key', () => {
    it('trims strings and ignores case', () => {
        expect(match_key('  Ada@Example.COM ', 'string')).toBe(
            match_key('ada@example.com', 'string')
        );
        expect(match_key('ada', 'string')).not.toBe(match_key('bea', 'string'));
    });

    it('compares numbers by value', () => {
        expect(match_key(42, 'number')).toBe(match_key('42.0', 'number'));
        expect(match_key(' 42 ', 'number')).toBe(match_key(42, 'number'));
        expect(match_key(-0, 'number')).toBe(match_key(0, 'number'));
        expect(match_key('forty', 'number')).toBeNull();
        expect(match_key(NaN, 'number')).toBeNull();
    });

    it('compares dates by instant', () => {
        const d = new Date('2026-10-02T00:00:00.000Z');
        expect(match_key(d, 'date')).toBe(match_key(new Date(d.getTime()), 'date'));
        expect(match_key(d, 'date')).toBe(match_key('2026-10-02T00:00:00Z', 'date'));
        expect(match_key(d, 'date')).not.toBe(match_key(new Date('2026-10-03'), 'date'));
        expect(match_key('not a date', 'date')).toBeNull();
    });

    it('never matches empty values', () => {
        for (const kind of ['string', 'number', 'date'] as const) {
            expect(match_key(null, kind)).toBeNull();
            expect(match_key(undefined, kind)).toBeNull();
            expect(match_key('', kind)).toBeNull();
            expect(match_key('   ', kind)).toBeNull();
        }
        expect(match_key({ $gt: '' }, 'string')).toBeNull();
        expect(match_key([A], 'string')).toBeNull();
    });

    it('reads numbers and dates as text when compared as text', () => {
        expect(match_key(42, 'string')).toBe(match_key('42', 'string'));
        const d = new Date('2026-10-02T00:00:00.000Z');
        expect(match_key(d, 'string')).toBe(match_key('2026-10-02T00:00:00.000Z', 'string'));
    });
});

describe('MatchIndex and match_row', () => {
    const index = new MatchIndex('string');
    index.add(A, 'ada@example.com');
    index.add(B, 'Bea@Example.com');
    index.add(C, ' bea@example.com');
    index.add(C, 'bea@example.com'); // the same row twice is one match
    index.add('not an id', 'x@example.com');
    index.add(A.replace('a', 'd'), null);

    it('links a row to its match', () => {
        const res = match_row(null, 'ADA@example.com ', index);
        expect(res).toEqual({ outcome: 'linked', ids: [A], multiple: false });
    });

    it('links a row to every match', () => {
        const res = match_row([], 'bea@example.com', index);
        expect(res).toEqual({ outcome: 'linked', ids: [B, C], multiple: true });
    });

    it('counts no match, and an empty value never matches', () => {
        expect(match_row(null, 'zed@example.com', index).outcome).toBe('no_match');
        expect(match_row(null, null, index).outcome).toBe('no_match');
        expect(match_row(null, '', index).outcome).toBe('no_match');
        expect(match_row(undefined, 'x@example.com', index).outcome).toBe('no_match');
    });

    it('leaves already-linked cells alone', () => {
        const res = match_row([C], 'ada@example.com', index);
        expect(res).toEqual({ outcome: 'already_linked', ids: [], multiple: false });
    });

    it('links at most a cell’s worth of rows', () => {
        const many = new MatchIndex('number');
        for (let i = 0; i < MAX_LINKS_PER_CELL + 5; i++) {
            many.add(i.toString(16).padStart(24, '0'), 7);
        }
        const res = match_row(null, 7, many);
        expect(res.ids.length).toBe(MAX_LINKS_PER_CELL);
        expect(res.multiple).toBe(true);
    });

    it('adds up the counts', () => {
        const counts = empty_counts();
        [
            match_row(null, 'ada@example.com', index),
            match_row(null, 'bea@example.com', index),
            match_row(null, 'nobody', index),
            match_row([A], 'ada@example.com', index)
        ].forEach(r => add_to_counts(counts, r));
        expect(counts).toEqual({ linked: 2, no_match: 1, multiple: 1, already_linked: 1 });
    });
});

describe('is_empty_link_cell', () => {
    it('is empty for null, missing and []', () => {
        expect(is_empty_link_cell(null)).toBe(true);
        expect(is_empty_link_cell(undefined)).toBe(true);
        expect(is_empty_link_cell([])).toBe(true);
        expect(is_empty_link_cell([A])).toBe(false);
    });
});

describe('parse_link_match_body', () => {
    it('takes the three fields and apply', () => {
        expect(parse_link_match_body({ field: 'c', source_field: 'a', target_field: 'b' })).toEqual(
            { field: 'c', source_field: 'a', target_field: 'b', apply: false }
        );
        expect(
            parse_link_match_body({ field: 'c', source_field: 'a', target_field: 'b', apply: true })
                .apply
        ).toBe(true);
    });

    it('refuses anything else', () => {
        expect(status_of(() => parse_link_match_body(null))).toBe(400);
        expect(status_of(() => parse_link_match_body([]))).toBe(400);
        expect(status_of(() => parse_link_match_body({ field: 'c', source_field: 'a' }))).toBe(400);
        expect(
            status_of(() =>
                parse_link_match_body({ field: { $ne: 1 }, source_field: 'a', target_field: 'b' })
            )
        ).toBe(400);
        expect(
            status_of(() =>
                parse_link_match_body({ field: '$c', source_field: 'a', target_field: 'b' })
            )
        ).toBe(400);
        expect(
            status_of(() =>
                parse_link_match_body({
                    field: 'c',
                    source_field: 'a',
                    target_field: 'b',
                    apply: 'yes'
                })
            )
        ).toBe(400);
    });
});

describe('the columns of a request', () => {
    const cols = [
        { field: 'a', col_type: 'string' },
        { field: 'c', col_type: 'link', link_table_id: 5 },
        { field: 'd', col_type: 'link', link_table_id: 6 },
        { field: 'e', col_type: 'string', deleted: true },
        { field: 'f' }
    ];
    const req = (over = {}) => ({
        field: 'c',
        source_field: 'a',
        target_field: 'b',
        apply: false,
        ...over
    });

    it('takes a link column and a plain column of this table', () => {
        const { link, source } = assert_source_columns(req(), cols);
        expect(link.field).toBe('c');
        expect(source.field).toBe('a');
        expect(assert_source_columns(req({ source_field: 'f' }), cols).source.field).toBe('f');
    });

    it('refuses a field that is not a link column, or a source that is one or missing', () => {
        expect(status_of(() => assert_source_columns(req({ field: 'a' }), cols))).toBe(400);
        expect(status_of(() => assert_source_columns(req({ field: 'zz' }), cols))).toBe(400);
        expect(status_of(() => assert_source_columns(req({ source_field: 'd' }), cols))).toBe(400);
        expect(status_of(() => assert_source_columns(req({ source_field: 'e' }), cols))).toBe(400);
        expect(
            status_of(() =>
                assert_source_columns(req(), [{ field: 'a' }, { field: 'c', col_type: 'link' }])
            )
        ).toBe(400);
    });

    it('takes a plain column of the linked table', () => {
        const target_cols = [
            { field: 'b', col_type: 'number' },
            { field: 'l', col_type: 'link', link_table_id: 1 }
        ];
        const target = assert_target_column(req(), target_cols);
        expect(target.field).toBe('b');
        expect(columns_match_kind({ field: 'a' }, target)).toBe('number');
        expect(status_of(() => assert_target_column(req({ target_field: 'l' }), target_cols))).toBe(
            400
        );
        expect(status_of(() => assert_target_column(req({ target_field: 'x' }), target_cols))).toBe(
            400
        );
    });
});
