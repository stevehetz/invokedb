import { HttpException, HttpStatus } from '@nestjs/common';
import { ObjectId } from 'mongodb';

const STRING_KEYS = ['field', 'headerName', 'col_type'];

function bad_request(message: string): never {
    throw new HttpException(message, HttpStatus.BAD_REQUEST);
}

/**
 * A column update is a user-controlled JSON object that goes into a Mongo `$set`, and its
 * `field` is used to create and drop indexes. Check its runtime types first: it must be a
 * plain object with no `$`-prefixed keys, `_id` must be a string or ObjectId, `field`,
 * `headerName` and `col_type` strings, and `indexed` a boolean (each may be left out). Other
 * keys (the grid's column settings) pass through as before.
 */
export function assert_column_update<T = Record<string, any>>(data: unknown): T {
    if (data === null || typeof data !== 'object' || Array.isArray(data)) {
        bad_request('Column update must be an object');
    }
    const col = data as Record<string, unknown>;
    if (Object.keys(col).some(key => key.startsWith('$'))) {
        bad_request('Column update keys must not start with $');
    }
    if (typeof col._id !== 'string' && !(col._id instanceof ObjectId)) {
        bad_request('Column update _id must be a string');
    }
    for (const key of STRING_KEYS) {
        if (col[key] !== undefined && col[key] !== null && typeof col[key] !== 'string') {
            bad_request(`Column update ${key} must be a string`);
        }
    }
    if (col.indexed !== undefined && col.indexed !== null && typeof col.indexed !== 'boolean') {
        bad_request('Column update indexed must be a boolean');
    }
    return data as T;
}
