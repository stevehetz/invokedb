import { http } from '@/core/http';

// The admin area (#277). Only admins get answers; everyone else gets 404 from every route.
export const admin_http = {
    async overview() {
        return http.get(http.get_url('/admin/overview'));
    },

    /**
     * @param {{ search?: string, sort?: string, dir?: string, page?: number, limit?: number,
     *   caps?: string, plan?: string }} [opts]
     */
    async accounts(opts = {}) {
        const params = new URLSearchParams();
        Object.entries(opts).forEach(([k, v]) => {
            if (v !== undefined && v !== null && v !== '')
                params.set(k, String(v));
        });
        const query = params.toString();
        return http.get(
            http.get_url(`/admin/accounts${query ? `?${query}` : ''}`)
        );
    },

    /** @param {number} id */
    async account(id) {
        return http.get(http.get_url(`/admin/accounts/${id}`));
    },

    /**
     * An action on an account: plan, lock, unlock, resend-verification, reset-two-factor or
     * delete.
     * @param {number} id
     * @param {string} action
     * @param {any} [body]
     */
    async act(id, action, body = {}) {
        return http.post(http.get_url(`/admin/accounts/${id}/${action}`), body);
    },

    /**
     * The tracked errors (#212), last seen first.
     * @param {{ source?: string, page?: number, limit?: number }} [opts]
     */
    async errors(opts = {}) {
        const params = new URLSearchParams();
        Object.entries(opts).forEach(([k, v]) => {
            if (v !== undefined && v !== null && v !== '')
                params.set(k, String(v));
        });
        const query = params.toString();
        return http.get(
            http.get_url(`/admin/errors${query ? `?${query}` : ''}`)
        );
    },

    /** @param {string} id */
    async error(id) {
        return http.get(
            http.get_url(`/admin/errors/${encodeURIComponent(id)}`)
        );
    },

    /** The status page's answer, with the incident note. */
    async status() {
        return http.get(http.get_url('/admin/status'));
    },

    /** @param {{ message: string, level: string }} note */
    async set_incident(note) {
        return http.post(http.get_url('/admin/status/incident'), note);
    },

    async clear_incident() {
        return http.post(http.get_url('/admin/status/incident/clear'), {});
    }
};
