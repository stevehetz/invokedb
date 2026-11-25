import { http } from '@/core/http';

const view_url = (id, rest = '') =>
    http.get_url(`/view/${encodeURIComponent(id)}${rest}`);

// Saved views of a table (#146): grid, kanban and chart views (signed in)
export const view_http = {
    /** @param {number} table that table's views and columns */
    async list(table) {
        return http.get(http.get_url(`/view?table=${table}`));
    },

    /** @param {object} body `{ file_id, name, type, filters, sort, hidden_fields, ... }` */
    async create(body) {
        return http.post(http.get_url('/view'), body);
    },

    /** @param {string} id @param {object} changes */
    async update(id, changes) {
        return http.put(view_url(id), changes);
    },

    /** @param {string} id */
    async remove(id) {
        return http.delete(view_url(id));
    },

    /** @param {string} id a kanban view's board */
    async kanban(id) {
        return http.get(view_url(id, '/kanban'));
    },

    /** @param {string} id a chart view's points */
    async chart(id) {
        return http.get(view_url(id, '/chart'));
    }
};
