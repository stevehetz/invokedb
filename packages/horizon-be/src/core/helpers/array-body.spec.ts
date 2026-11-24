import { HttpException, HttpStatus } from '@nestjs/common';
import { assert_array_body } from './array-body';

describe('assert_array_body', () => {
    it.each([[[]], [[{ a: 1 }]], [[{ a: 1 }, { b: 2 }]]])('returns the array %j', data => {
        expect(assert_array_body(data)).toBe(data);
    });

    it.each([
        ['an object with a fake length', { length: -1000 }],
        ['an object', { a: 1 }],
        ['a string', 'abc'],
        ['a number', 3],
        ['null', null],
        ['undefined', undefined]
    ])('rejects %s with 400', (_label, data) => {
        try {
            assert_array_body(data);
            throw new Error('expected assert_array_body to throw');
        } catch (ex) {
            expect(ex).toBeInstanceOf(HttpException);
            expect((ex as HttpException).getStatus()).toBe(HttpStatus.BAD_REQUEST);
        }
    });
});
