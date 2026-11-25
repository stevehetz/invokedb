import { http } from '@/core/http';

const view_url = (id, rest = '') =>
    http.get_url(`/view/${encodeURIComponent(id)}${rest}`);

// Saved views of a table (#146): grid, kanban, chart, calendar and map views (signed in)
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
    },

    /**
     * A calendar view's events (#211), from `from` up to but not including `to`
     * @param {string} id @param {string} from YYYY-MM-DD @param {string} to YYYY-MM-DD
     */
    async calendar(id, from, to) {
        const q = `?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
        return http.get(view_url(id, `/calendar${q}`));
    },

    /** @param {string} id a map view's points (#211) */
    async map(id) {
        return http.get(view_url(id, '/map'));
    }
};
