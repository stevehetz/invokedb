import { createHash } from 'node:crypto';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import {
    ApiKeyScope,
    MAX_KEY_NAME,
    MAX_KEY_TABLES,
    REVOKED_KEPT_DAYS,
    assert_key_allows,
    hash_api_key,
    key_prefix,
    key_refusal,
    parse_new_key,
    revoked_cutoff,
    should_touch_last_used
} from './api-key-rules';

const KEY = 'fmh99QgCYnufhYDuAYSgpPblGAYgEWi7';
const scope = (over: Partial<ApiKeyScope> = {}): ApiKeyScope => ({
    key_id: 1,
    access: 'read_write',
    table_ids: null,
    ...over
});

describe('hash_api_key', () => {
    it('is the hex SHA-256 of the key, as the migration computes it in Postgres', () => {
        expect(hash_api_key(KEY)).toBe(createHash('sha256').update(KEY).digest('hex'));
        expect(hash_api_key(KEY)).toMatch(/^[0-9a-f]{64}$/);
    });

    it('differs for different keys and never contains the key', () => {
        expect(hash_api_key(KEY)).not.toBe(hash_api_key(KEY.slice(0, -1) + 'x'));
        expect(hash_api_key(KEY)).not.toContain(KEY);
    });
});

describe('key_prefix', () => {
    it('is the first 6 characters', () => {
        expect(key_prefix(KEY)).toBe('fmh99Q');
    });
});

describe('parse_new_key', () => {
    it('takes a name, an access and no tables (every table)', () => {
        expect(parse_new_key({ name: '  Website ', access: 'read' })).toEqual({
            name: 'Website',
            access: 'read',
            table_ids: null
        });
        expect(parse_new_key({ name: 'x', access: 'read_write', table_ids: null }).table_ids).toBe(
            null
        );
    });

    it('takes a list of table ids, once each', () => {
        const key = parse_new_key({ name: 'x', access: 'read', table_ids: [3, '4', 3] });
        expect(key.table_ids).toEqual([3, 4]);
    });

    it.each([
        [undefined],
        [{}],
        [{ name: '', access: 'read' }],
        [{ name: '   ', access: 'read' }],
        [{ name: 'x'.repeat(MAX_KEY_NAME + 1), access: 'read' }],
        [{ name: 'x', access: 'admin' }],
        [{ name: 'x' }],
        [{ name: 'x', access: 'read', table_ids: 3 }],
        [{ name: 'x', access: 'read', table_ids: [] }],
        [{ name: 'x', access: 'read', table_ids: ['a'] }],
        [{ name: 'x', access: 'read', table_ids: [1.5] }],
        [{ name: 'x', access: 'read', table_ids: [0] }],
        [{ name: 'x', access: 'read', table_ids: [-2] }],
        [
            {
                name: 'x',
                access: 'read',
                table_ids: Array.from({ length: MAX_KEY_TABLES + 1 }, (_, i) => i + 1)
            }
        ]
    ])('refuses %j', body => {
        expect(() => parse_new_key(body)).toThrow(BadRequestException);
    });
});

describe('key_refusal / assert_key_allows', () => {
    it('lets a read-write key for every table do anything', () => {
        expect(key_refusal(scope(), 7, false)).toBeNull();
        expect(key_refusal(scope(), 7, true)).toBeNull();
        expect(() => assert_key_allows(scope(), 7, true)).not.toThrow();
    });

    it('lets a read-only key read but not write', () => {
        const ro = scope({ access: 'read' });
        expect(key_refusal(ro, 7, false)).toBeNull();
        expect(key_refusal(ro, 7, true)).toBe('read_only');
        expect(() => assert_key_allows(ro, 7, true)).toThrow(ForbiddenException);
        expect(() => assert_key_allows(ro, 7)).not.toThrow();
    });

    it('limits a table-scoped key to its tables', () => {
        const some = scope({ table_ids: [3, 4] });
        expect(key_refusal(some, 3, true)).toBeNull();
        expect(key_refusal(some, 4, false)).toBeNull();
        expect(key_refusal(some, 5, false)).toBe('table');
        expect(key_refusal(some, '3' as any, false)).toBeNull();
        expect(() => assert_key_allows(some, 5)).toThrow(ForbiddenException);
    });

    it('refuses a write on another table for a read-only scoped key', () => {
        expect(key_refusal(scope({ access: 'read', table_ids: [3] }), 5, true)).not.toBeNull();
    });

    it('refuses a caller without a key scope', () => {
        expect(() => assert_key_allows(undefined, 3)).toThrow(ForbiddenException);
    });
});

describe('should_touch_last_used', () => {
    const now = new Date('2026-11-25T12:00:00Z');

    it('writes the first use and after a minute', () => {
        expect(should_touch_last_used(null, now)).toBe(true);
        expect(should_touch_last_used(new Date('2026-11-25T11:58:59Z'), now)).toBe(true);
    });

    it('skips the write within a minute', () => {
        expect(should_touch_last_used(new Date('2026-11-25T11:59:30Z'), now)).toBe(false);
    });
});

describe('revoked_cutoff', () => {
    it('is REVOKED_KEPT_DAYS before now', () => {
        const now = new Date('2026-11-25T12:00:00Z');
        expect(now.getTime() - revoked_cutoff(now).getTime()).toBe(
            REVOKED_KEPT_DAYS * 24 * 60 * 60 * 1000
        );
    });
});
