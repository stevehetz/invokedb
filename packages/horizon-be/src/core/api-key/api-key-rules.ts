// Several API keys per account (#138): pure rules, unit-tested in api-key-rules.spec.ts.
// ApiKeyService stores the keys (Postgres `api_key`) and the bearer strategy resolves them.
import { createHash } from 'node:crypto';
import { BadRequestException, ForbiddenException } from '@nestjs/common';

export const API_KEY_ACCESS = ['read', 'read_write'] as const;
export type ApiKeyAccess = (typeof API_KEY_ACCESS)[number];

// Live (not revoked) keys per account. #137 may set this per plan.
export const MAX_API_KEYS = 20;
export const MAX_KEY_NAME = 100;
export const MAX_KEY_TABLES = 100;
// The start of a key, kept in plain text so the owner can tell their keys apart
export const KEY_PREFIX_LENGTH = 6;
// last_used_datetime is written at most this often per key, not on every call
export const LAST_USED_EVERY_MS = 60 * 1000;
// A revoked key is listed this long, then deleted (#178). It never works again either way; this
// keeps the list short for an account that rotates keys often (the E2E test account revokes a
// few every run).
export const REVOKED_KEPT_DAYS = 7;

/** Keys revoked before this are deleted when the account's keys are listed. */
export function revoked_cutoff(now: Date): Date {
    return new Date(now.getTime() - REVOKED_KEPT_DAYS * 24 * 60 * 60 * 1000);
}

/** What one key may do; set on the `Account` an /api/v1 caller resolves to. */
export interface ApiKeyScope {
    key_id: number;
    access: ApiKeyAccess;
    // null: every table of the account, now and later
    table_ids: number[] | null;
    // Who made a change, in the audit log (#217); never the key itself
    name?: string;
    prefix?: string;
}

export interface NewApiKey {
    name: string;
    access: ApiKeyAccess;
    table_ids: number[] | null;
}

/**
 * Keys are random 32-character strings (generate_api_key), so a fast hash is enough: there's
 * nothing to guess from it. Only this and the prefix are stored.
 */
export function hash_api_key(key: string): string {
    return createHash('sha256').update(key, 'utf8').digest('hex');
}

export function key_prefix(key: string): string {
    return key.slice(0, KEY_PREFIX_LENGTH);
}

function bad_request(message: string): never {
    throw new BadRequestException(message);
}

/** Checks a create body: `{ name, access, table_ids? }` (no `table_ids` or null: every table). */
export function parse_new_key(body: unknown): NewApiKey {
    const b: any = body && typeof body === 'object' ? body : {};
    const name = typeof b.name === 'string' ? b.name.trim() : '';
    if (!name) bad_request('name is required');
    if (name.length > MAX_KEY_NAME) bad_request(`name is longer than ${MAX_KEY_NAME} characters`);
    if (!(API_KEY_ACCESS as readonly unknown[]).includes(b.access)) {
        bad_request(`access must be one of ${API_KEY_ACCESS.join(', ')}`);
    }
    let table_ids: number[] | null = null;
    if (b.table_ids !== undefined && b.table_ids !== null) {
        if (!Array.isArray(b.table_ids)) bad_request('table_ids must be a list of table ids');
        const ids = b.table_ids.map(Number);
        if (!ids.every(id => Number.isInteger(id) && id > 0)) {
            bad_request('table_ids must be a list of table ids');
        }
        table_ids = [...new Set<number>(ids)];
        if (table_ids.length === 0) bad_request('Pick at least one table, or leave out table_ids');
        if (table_ids.length > MAX_KEY_TABLES) bad_request(`At most ${MAX_KEY_TABLES} tables`);
    }
    return { name, access: b.access, table_ids };
}

/** Why a key can't make this call, or null if it can. */
export function key_refusal(
    scope: ApiKeyScope,
    table_id: number,
    write: boolean
): 'read_only' | 'table' | null {
    if (write && scope.access !== 'read_write') return 'read_only';
    if (scope.table_ids && !scope.table_ids.includes(Number(table_id))) return 'table';
    return null;
}

/** Throws 403 unless the key may make this call (`write`: create, update or delete rows). */
export function assert_key_allows(scope: ApiKeyScope | undefined, table_id: number, write = false) {
    if (!scope) throw new ForbiddenException('Not an API key');
    const refusal = key_refusal(scope, table_id, write);
    if (refusal === 'read_only') {
        throw new ForbiddenException('This API key is read-only');
    }
    if (refusal === 'table') {
        throw new ForbiddenException("This API key can't access this table");
    }
}

export function should_touch_last_used(last_used: Date | null | undefined, now: Date): boolean {
    if (!last_used) return true;
    return now.getTime() - new Date(last_used).getTime() >= LAST_USED_EVERY_MS;
}
