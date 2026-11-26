import { http } from '@/core/http';

/** @param {number} table @param {string} field @param {string} [rest] */
const column_url = (table, field, rest = '') =>
    http.get_url(
        `/ai-column/${encodeURIComponent(table)}/${encodeURIComponent(field)}${rest}`
    );

// AI columns (#205): a column the AI fills per row from a prompt over other columns
export const ai_column_http = {
    /** @param {number} table that table's AI columns: `{ columns, limits }` */
    async list(table) {
        return http.get(http.get_url(`/ai-column?table=${table}`));
    },

    /** @param {{ table: number, field: string, prompt: string, inputs: string[] }} body */
    async save(body) {
        return http.put(http.get_url('/ai-column'), body);
    },

    /**
     * The AI rows filling the column would use: `{ rows, empty, left, limit, available }`
     * @param {number} table @param {string} field
     */
    async estimate(table, field) {
        return http.get(column_url(table, field, '/estimate'));
    },

    /** @param {number} table @param {string} field */
    async fill(table, field) {
        return http.post(column_url(table, field, '/fill'), {});
    },

    /** @param {number} table @param {string} field */
    async remove(table, field) {
        return http.delete(column_url(table, field));
    }
};
