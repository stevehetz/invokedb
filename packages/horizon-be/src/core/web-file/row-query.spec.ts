import { HttpException } from '@nestjs/common';
import { ObjectId } from 'mongodb';
import {
    QueryColumn,
    after_cursor,
    decode_cursor,
    encode_cursor,
    explain_indexes,
    mongo_sort,
    parse_count_query,
    parse_row_query
} from './row-query';

const columns: QueryColumn[] = [
    { name: 'name', header_name: 'name', field: 'a', type: 'string' },
    { name: 'age', header_name: 'age', field: 'b', type: 'number' },
    { name: 'joined', header_name: 'joined', field: 'c', type: 'date' },
    { name: 'firstName', header_name: 'First Name', field: 'd', type: 'string' }
];

function bad(body: unknown, message?: RegExp) {
    let error: unknown;
    try {
        parse_row_query(body, columns);
    } catch (ex) {
        error = ex;
    }
    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(400);
    if (message) expect((error as HttpException).message).toMatch(message);
}

describe('parse_row_query', () => {
    it('defaults to every column, sorted by _id, 100 rows', () => {
        const q = parse_row_query(undefined, columns);
        expect(q.filter).toEqual({});
        expect(q.sort).toEqual([{ field: '_id', dir: 1 }]);
        expect(q.fields.map(c => c.name)).toEqual(['name', 'age', 'joined', 'firstName']);
        expect(q.limit).toBe(100);
        expect(q.explain).toBe(false);
    });

    it('combines filters with $and, or $or for match any', () => {
        const filters = [
            { column: 'name', op: 'eq', value: 'bob' },
            { column: 'age', op: 'gte', value: 30 }
        ];
        expect(parse_row_query({ filters }, columns).filter).toEqual({
            $and: [{ a: 'bob' }, { b: { $gte: 30 } }]
        });
        expect(parse_row_query({ filters, match: 'any' }, columns).filter).toEqual({
            $or: [{ a: 'bob' }, { b: { $gte: 30 } }]
        });
    });

    it('builds every operator', () => {
        const f = (filter: object) =>
            parse_row_query({ filters: [filter] }, columns).filter.$and[0];
        expect(f({ column: 'name', op: 'ne', value: 'x' })).toEqual({ a: { $ne: 'x' } });
        expect(f({ column: 'age', op: 'gt', value: 1 })).toEqual({ b: { $gt: 1 } });
        expect(f({ column: 'age', op: 'lt', value: 1 })).toEqual({ b: { $lt: 1 } });
        expect(f({ column: 'age', op: 'lte', value: 1 })).toEqual({ b: { $lte: 1 } });
        expect(f({ column: 'age', op: 'in', value: [1, 2] })).toEqual({ b: { $in: [1, 2] } });
        expect(f({ column: 'name', op: 'contains', value: 'a.b' })).toEqual({
            a: { $regex: 'a\\.b', $options: 'i' }
        });
        expect(f({ column: 'name', op: 'contains', value: 'A', case: 'sensitive' })).toEqual({
            a: { $regex: 'A', $options: '' }
        });
        expect(f({ column: 'name', op: 'empty', value: true })).toEqual({
            a: { $in: [null, ''] }
        });
        expect(f({ column: 'name', op: 'empty', value: false })).toEqual({
            a: { $nin: [null, ''] }
        });
        expect(f({ column: 'joined', op: 'gte', value: '2020-01-02' })).toEqual({
            c: { $gte: new Date(Date.UTC(2020, 0, 2)) }
        });
        const id = '5f38f1a22a3a9d1db22bae3d';
        expect(f({ column: '_id', op: 'eq', value: id })).toEqual({ _id: new ObjectId(id) });
    });

    it('matches text exactly with eq, so an index on the column can be used', () => {
        const q = parse_row_query(
            { filters: [{ column: 'name', op: 'eq', value: 'Bob' }] },
            columns
        );
        expect(q.filter.$and[0]).toEqual({ a: 'Bob' });
    });

    it('accepts the formatted name or the grid name of a column', () => {
        const by = (column: string) =>
            parse_row_query({ filters: [{ column, op: 'eq', value: 'x' }] }, columns).filter;
        expect(by('firstName')).toEqual(by('First Name'));
    });

    it('rejects bad column names, operators and values with a 400', () => {
        bad({ filters: [{ column: 'nope', op: 'eq', value: 1 }] }, /unknown column/);
        bad({ filters: [{ column: 'age', op: '$where', value: 1 }] }, /unknown operator/);
        bad({ filters: [{ column: 'age', op: 'eq', value: '1' }] }, /must be a number/);
        bad({ filters: [{ column: 'age', op: 'eq', value: { $gt: 1 } }] }, /must be a number/);
        bad({ filters: [{ column: 'name', op: 'eq', value: { $ne: null } }] }, /must be a string/);
        bad({ filters: [{ column: 'joined', op: 'eq', value: 'not a date' }] }, /date column/);
        bad({ filters: [{ column: 'age', op: 'contains', value: '1' }] }, /text columns/);
        bad({ filters: [{ column: 'age', op: 'in', value: [] }] }, /in takes an array/);
        bad({ filters: [{ column: 'name', op: 'empty', value: 'yes' }] }, /empty takes/);
        bad({ filters: [{ column: '_id', op: 'gt', value: 'x' }] }, /_id takes/);
        bad({ filters: [{ column: '_id', op: 'eq', value: { $gt: '' } }] }, /hex/);
        bad({ filters: [{ column: 'name', op: 'eq' }] }, /value is required/);
        bad({ filters: [{ column: 'name', op: 'eq', value: 'x', extra: 1 }] }, /Unknown/);
        bad({ filters: [{ column: 'name', op: 'eq', value: 'x', case: 'i' }] }, /case/);
        bad({ filters: { name: 'x' } }, /filters must be an array/);
        bad({ filters: ['x'] }, /must be an object/);
        bad({ match: 'some' }, /match/);
        bad({ filter: [] }, /Unknown body key: filter/);
        bad([], /JSON object/);
    });

    it('sorts by columns, then _id', () => {
        const q = parse_row_query({ sort: ['-age', { column: 'name', dir: 'asc' }] }, columns);
        expect(mongo_sort(q.sort)).toEqual({ b: -1, a: 1, _id: 1 });
        expect(Object.keys(mongo_sort(q.sort))).toEqual(['b', 'a', '_id']);
        const by_id = parse_row_query({ sort: [{ column: '_id', dir: 'desc' }] }, columns);
        expect(by_id.sort).toEqual([{ field: '_id', dir: -1 }]);
        bad({ sort: ['nope'] }, /unknown column/);
        bad({ sort: [{ column: 'age', dir: 'up' }] }, /dir/);
        bad({ sort: ['age', 'age'] }, /twice/);
        bad({ sort: ['_id', 'age'] }, /last/);
        bad({ sort: 'age' }, /sort must be an array/);
    });

    it('returns only the chosen fields, but reads the sort columns too', () => {
        const q = parse_row_query({ fields: ['name'], sort: ['age'] }, columns);
        expect(q.fields.map(c => c.name)).toEqual(['name']);
        expect(q.projection).toEqual({ _id: 1, a: 1, b: 1 });
        bad({ fields: [] }, /fields/);
        bad({ fields: ['nope'] }, /unknown column/);
    });

    it('checks limit against the maximum', () => {
        expect(parse_row_query({ limit: 5 }, columns).limit).toBe(5);
        expect(parse_row_query({ limit: 50 }, columns, 50).limit).toBe(50);
        bad({ limit: 0 }, /limit/);
        bad({ limit: 1.5 }, /limit/);
        bad({ limit: '10' }, /limit/);
        bad({ limit: 1001 }, /limit/);
        expect(() => parse_row_query({ limit: 51 }, columns, 50)).toThrow(/1 to 50/);
    });

    it('checks explain', () => {
        expect(parse_row_query({ explain: true }, columns).explain).toBe(true);
        bad({ explain: 'yes' }, /explain/);
    });
});

describe('cursors', () => {
    const id = new ObjectId('5f38f1a22a3a9d1db22bae3d');

    it('round-trips the last row and pages after it', () => {
        const first = parse_row_query({ sort: ['-age', 'joined'], limit: 2 }, columns);
        const joined = new Date(Date.UTC(2020, 0, 2));
        const cursor = encode_cursor({ _id: id, b: 30, c: joined }, first.sort, first.signature);
        expect(decode_cursor(cursor, first.sort, first.signature)).toEqual([30, joined, id]);
        const next = parse_row_query({ sort: ['-age', 'joined'], limit: 2, cursor }, columns);
        expect(next.filter).toEqual({
            $or: [
                { $or: [{ b: { $lt: 30 } }, { b: null }] },
                { $and: [{ b: 30 }, { c: { $gt: joined } }] },
                { $and: [{ b: 30 }, { c: joined }, { _id: { $gt: id } }] }
            ]
        });
    });

    it('keeps the filters alongside the cursor', () => {
        const body = { filters: [{ column: 'age', op: 'gt', value: 1 }] };
        const first = parse_row_query(body, columns);
        const cursor = encode_cursor({ _id: id }, first.sort, first.signature);
        expect(parse_row_query({ ...body, cursor }, columns).filter).toEqual({
            $and: [{ $and: [{ b: { $gt: 1 } }] }, { $or: [{ _id: { $gt: id } }] }]
        });
    });

    it('handles empty (null) sort values', () => {
        const sort = [
            { field: 'a', dir: 1 as const },
            { field: '_id', dir: 1 as const }
        ];
        expect(after_cursor(sort, [null, id])).toEqual({
            $or: [{ a: { $ne: null } }, { $and: [{ a: null }, { _id: { $gt: id } }] }]
        });
        const desc = [
            { field: 'a', dir: -1 as const },
            { field: '_id', dir: 1 as const }
        ];
        expect(after_cursor(desc, [null, id])).toEqual({
            $or: [{ $and: [{ a: null }, { _id: { $gt: id } }] }]
        });
    });

    it('rejects a cursor from another query or one that was tampered with', () => {
        const first = parse_row_query({ sort: ['age'] }, columns);
        const cursor = encode_cursor({ _id: id, b: 3 }, first.sort, first.signature);
        bad({ sort: ['-age'], cursor }, /other filters or sort/);
        bad({ sort: ['age'], cursor: 'not base64 json' }, /cursor is not valid/);
        bad({ sort: ['age'], cursor: 5 }, /cursor must be/);
        const evil = Buffer.from(
            JSON.stringify({ s: first.signature, v: [{ $gt: '' }, { o: id.toHexString() }] })
        ).toString('base64url');
        bad({ sort: ['age'], cursor: evil }, /cursor is not valid/);
        const no_id = Buffer.from(JSON.stringify({ s: first.signature, v: [3, 'x'] })).toString(
            'base64url'
        );
        bad({ sort: ['age'], cursor: no_id }, /cursor is not valid/);
    });
});

describe('parse_count_query', () => {
    it('takes filters and match only', () => {
        expect(parse_count_query({}, columns).filter).toEqual({});
        expect(
            parse_count_query({ filters: [{ column: 'age', op: 'lt', value: 3 }] }, columns).filter
        ).toEqual({ $and: [{ b: { $lt: 3 } }] });
        expect(() => parse_count_query({ limit: 1 }, columns)).toThrow(/Unknown body key/);
    });
});

describe('explain_indexes', () => {
    it('finds the indexed columns in the winning plan', () => {
        const explain = {
            queryPlanner: {
                winningPlan: {
                    stage: 'LIMIT',
                    inputStage: {
                        stage: 'SORT',
                        inputStage: {
                            stage: 'FETCH',
                            inputStage: { stage: 'IXSCAN', keyPattern: { b: 1 }, indexName: 'b_1' }
                        }
                    }
                }
            }
        };
        expect(explain_indexes(explain, columns)).toEqual({
            uses_index: true,
            index_columns: ['age']
        });
    });

    it('reads the newer queryPlan shape and reports a collection scan', () => {
        const sbe = {
            queryPlanner: {
                winningPlan: { queryPlan: { stage: 'COLLSCAN', filter: {} } }
            }
        };
        expect(explain_indexes(sbe, columns)).toEqual({ uses_index: false, index_columns: [] });
    });
});
