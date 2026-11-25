import { http } from '@/core/http';

// AI features, signed in: "ask your data" (#149) and generated rows and tables (#148). The
// server calls the model; when AI is off (no API key or budget, or the month's budget is
// spent) `status()` says `available: false` and the app hides the AI buttons.

/** @type {Promise<any> | null} */
let cached_status = null;

export const ai_http = {
    /**
     * `{ available, usage: { month, used, limit, tier, verified, budget_used }, rows: { month,
     * used, limit }, limits }`: `usage` counts questions, `rows` generated rows. Always fresh.
     */
    async status() {
        const promise = http.get(http.get_url('/ai/status'));
        cached_status = promise;
        promise.catch(() => (cached_status = null));
        return promise;
    },

    /**
     * Whether the AI buttons should show (AI on and the email verified); false when the
     * status can't be read. Fetched once per page load.
     */
    async enabled() {
        try {
            const status = await (cached_status || this.status());
            return !!(
                status &&
                status.available &&
                status.usage?.verified !== false
            );
        } catch (ex) {
            return false;
        }
    },

    /**
     * Ask a question about a table: `{ answer, rows, columns, total, api_call, usage }`
     * @param {number} table the table's id
     * @param {string} question
     */
    async ask(table, question) {
        return http.post(http.get_url('/ai/ask'), { table, question });
    },

    /**
     * Applies an edit Ask AI proposed (#204), or undoes one (before and after swapped). A row
     * is written only if it still holds `before`: `{ updated: [ids], skipped: [ids] }`.
     * @param {number} table the table's id
     * @param {{ _id: string, before: object, after: object }[]} rows
     */
    async apply_edit(table, rows) {
        return http.post(http.get_url(`/ai/web-file/${table}/apply-edit`), {
            rows
        });
    },

    /**
     * A new table's design and rows, not saved: `{ table_name, columns, rows, usage }`.
     * @param {{ description: string, row_count: number }} body
     */
    async preview_table(body) {
        return http.post(http.get_url('/ai/table/preview'), body);
    },

    /**
     * Makes the previewed table; answers its id.
     * @param {{ table_name: string, columns: any[], rows: any[], parent_id?: number | null }} body
     */
    async create_table(body) {
        return http.post(http.get_url('/ai/table'), body);
    }
};
