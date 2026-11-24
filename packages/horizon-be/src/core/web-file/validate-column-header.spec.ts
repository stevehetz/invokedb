import { HttpException } from '@nestjs/common';
import { WebFileManager } from './web-file.manager';

// validate_column_header uses no injected services, so call it without building the manager
const validate = (existing: string[], name: unknown) =>
    WebFileManager.prototype.validate_column_header.call(
        {},
        existing.map(headerName => ({ headerName })),
        name
    );

describe('WebFileManager.validate_column_header', () => {
    it.each(['name', 'First Name', 'price_usd', 'a-b.c$!'])('accepts "%s"', name =>
        expect(() => validate(['other'], name)).not.toThrow()
    );

    it('rejects a duplicate name', () => {
        expect(() => validate(['name'], 'name')).toThrow(/Duplicate column name/);
    });

    it.each(['$or', '$and', 'row', 'ROW_NUM', 'Row Num', 'rownum'])(
        'rejects the reserved name "%s"',
        name => expect(() => validate([], name)).toThrow(/reserved column name/)
    );

    it('rejects an empty or blank name', () => {
        expect(() => validate([], '')).toThrow(/cannot be empty/);
        expect(() => validate([], '   ')).toThrow(/cannot be empty/);
    });

    it.each([undefined, null, 42, {}, ['a']])('rejects the missing or non-string name %p', name => {
        try {
            validate([], name);
        } catch (e) {
            expect(e).toBeInstanceOf(HttpException);
            expect((e as HttpException).getStatus()).toBe(403);
            expect((e as HttpException).message).toMatch(/cannot be empty/);
        }
        expect.assertions(3);
    });

    it('rejects a name over 100 characters', () => {
        expect(() => validate([], 'x'.repeat(101))).toThrow(/greater than 100/);
        expect(() => validate([], 'x'.repeat(100))).not.toThrow();
    });

    it.each(['a/b', 'a{b}', 'a"b', 'é'])('rejects the invalid character in "%s"', name =>
        expect(() => validate([], name)).toThrow(/Valid characters/)
    );

    it('throws HttpExceptions (403), not plain errors', () => {
        try {
            validate([], '$or');
        } catch (e) {
            expect(e).toBeInstanceOf(HttpException);
            expect((e as HttpException).getStatus()).toBe(403);
        }
        expect.assertions(2);
    });
});
