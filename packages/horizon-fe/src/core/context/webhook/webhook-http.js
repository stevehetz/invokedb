import { http } from '@/core/http';

// Webhooks on row changes (#140)
export const webhook_http = {
    /** @param {number} table the webhooks that fire for this table */
    async list(table) {
        return http.get(http.get_url(`/webhook?table=${table}`));
    },

    /** @param {{ url: string, events: string[], file_id: number | null }} body */
    async create(body) {
        return http.post(http.get_url('/webhook'), body);
    },

    /** @param {string} id @param {object} changes */
    async update(id, changes) {
        return http.put(
            http.get_url(`/webhook/${encodeURIComponent(id)}`),
            changes
        );
    },

    /** @param {string} id */
    async remove(id) {
        return http.delete(http.get_url(`/webhook/${encodeURIComponent(id)}`));
    },

    /** @param {string} id */
    async test(id) {
        return http.post(
            http.get_url(`/webhook/${encodeURIComponent(id)}/test`)
        );
    },

    /** @param {string} id */
    async deliveries(id) {
        return http.get(
            http.get_url(`/webhook/${encodeURIComponent(id)}/deliveries`)
        );
    }
};
