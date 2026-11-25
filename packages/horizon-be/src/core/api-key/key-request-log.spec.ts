import { MAX_LOGGED_PATH, key_request_entry } from './key-request-log';

describe('key_request_entry', () => {
    it('keeps the time, method, path, status and duration', () => {
        expect(key_request_entry('get', '/api/v1/get', 200, 1000, 1042)).toEqual({
            at: 1042,
            method: 'GET',
            path: '/api/v1/get',
            status: 200,
            duration_ms: 42
        });
    });

    it('never keeps the query string or fragment', () => {
        const entry = key_request_entry(
            'POST',
            '/api/v1/query?table=secret_table&expand=a',
            429,
            0,
            1
        );
        expect(entry.path).toBe('/api/v1/query');
        expect(JSON.stringify(entry)).not.toContain('secret_table');
        expect(key_request_entry('GET', '/api/v1/get#x', 200, 0, 0).path).toBe('/api/v1/get');
    });

    it('cuts long paths and copes with odd input', () => {
        expect(key_request_entry('GET', '/' + 'a'.repeat(500), 200, 0, 0).path).toHaveLength(
            MAX_LOGGED_PATH
        );
        const odd = key_request_entry(undefined, undefined, 'x', 10, 5);
        expect(odd).toEqual({ at: 5, method: '', path: '/', status: 0, duration_ms: 0 });
    });
});
