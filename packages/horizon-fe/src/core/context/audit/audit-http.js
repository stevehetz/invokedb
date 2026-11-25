import { http } from '@/core/http';

// The audit log (#217): who changed what, newest first
export const audit_http = {
    /**
     * @param {{ table?: number | null, cursor?: string | null, limit?: number }} [opts]
     *   `table`: one table's entries (otherwise the whole account's); `cursor`: the last
     *   page's `next_cursor`
     */
    async list(opts = {}) {
        const params = new URLSearchParams();
        if (opts.table) params.set('table', String(opts.table));
        if (opts.cursor) params.set('cursor', opts.cursor);
        if (opts.limit) params.set('limit', String(opts.limit));
        const query = params.toString();
        return http.get(http.get_url(`/audit${query ? `?${query}` : ''}`));
    }
};
