import { HttpException, HttpStatus } from '@nestjs/common';
import { ObjectId } from 'mongodb';
import { assert_column_update } from './column-update';

const _id = '64b7f0c2a1b2c3d4e5f60718';

describe('assert_column_update', () => {
    it.each([
        [
            'a full column from the grid',
            {
                _id,
                field: 'a',
                headerName: 'age',
                col_type: 'number',
                indexed: true,
                width: 120,
                filterParams: { buttons: ['reset'] }
            }
        ],
        ['a column with only an _id', { _id }],
        ['a delete with an ObjectId', { _id: new ObjectId(_id), deleted: true }],
        [
            'nulls for the optional fields',
            { _id, field: null, headerName: null, col_type: null, indexed: null }
        ]
    ])('accepts %s', (_label, data) => {
        expect(assert_column_update(data)).toBe(data);
    });

    it.each([
        ['an array', [{ _id }]],
        ['a string', 'abc'],
        ['null', null],
        ['undefined', undefined],
        ['a missing _id', { field: 'a' }],
        ['an object _id', { _id: { $ne: null } }],
        ['a $-prefixed key', { _id, $where: 'true' }],
        ['an object field', { _id, field: { a: 1, b: 'text' } }],
        ['an array headerName', { _id, headerName: ['age'] }],
        ['an object col_type', { _id, col_type: { $gt: '' } }],
        ['a string indexed', { _id, indexed: 'yes' }]
    ])('rejects %s with 400', (_label, data) => {
        try {
            assert_column_update(data);
            throw new Error('expected assert_column_update to throw');
        } catch (ex) {
            expect(ex).toBeInstanceOf(HttpException);
            expect((ex as HttpException).getStatus()).toBe(HttpStatus.BAD_REQUEST);
        }
    });
});
