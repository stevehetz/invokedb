import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Batch endpoints take a JSON array of records. A request body is user-controlled, so check
 * its runtime type before using `.length` or `.forEach` on it: an object such as
 * `{ "length": -1000 }` would otherwise feed a made-up count into the row and column limits.
 */
export function assert_array_body<T = any>(data: unknown): T[] {
    if (!Array.isArray(data)) {
        throw new HttpException('Request body must be an array', HttpStatus.BAD_REQUEST);
    }
    return data;
}
