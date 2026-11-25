import { http } from '@/core/http';
import { store } from '@/store';

// The account's API keys (#138). A key is only shown when it's made: the newest one made in this
// visit is kept in memory (store 'new_api_key', never saved) so the onboarding checklist and the
// API docs' "Try it" can use it.
export const api_key_http = {
    /** `{ keys, max, tables }` */
    async list() {
        return http.get(http.get_url('/api-key'));
    },

    /**
     * @param {{ name: string, access: string, table_ids: number[] | null,
     *   rate_limit_per_second?: number | null, rate_limit_burst?: number | null }} body
     *   access: 'read' or 'read_write'; no rate limit: only the account's applies (#216)
     * @returns {Promise<{ key: any, secret: string }>}
     */
    async create(body) {
        const res = await http.post(http.get_url('/api-key'), body);
        if (res && res.secret) {
            store.set('new_api_key', { ...res.key, secret: res.secret });
        }
        return res;
    },

    /**
     * The key's last requests, newest first (#216).
     * @param {number} id
     * @returns {Promise<{ requests: { at: number, method: string, path: string,
     *   status: number, duration_ms: number }[], max: number }>}
     */
    async requests(id) {
        return http.get(
            http.get_url(`/api-key/${encodeURIComponent(id)}/requests`)
        );
    },

    /** @param {number} id */
    async revoke(id) {
        const res = await http.delete(
            http.get_url(`/api-key/${encodeURIComponent(id)}`)
        );
        const kept = store.get('new_api_key');
        if (kept && kept.id === id) store.set('new_api_key', null);
        return res;
    }
};
