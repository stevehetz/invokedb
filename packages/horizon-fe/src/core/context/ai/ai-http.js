import { http } from '@/core/http';

// AI-generated rows and tables (#148). The server calls the model; when it has no API key,
// `status()` says `enabled: false` and the app hides the AI buttons.

/** @type {Promise<any> | null} */
let status_promise = null;

export const ai_http = {
    /** `{ enabled, usage: { month, used, allowance }, limits }`, fetched once per page load. */
    async status() {
        if (!status_promise) {
            status_promise = http.get(http.get_url('/ai/status'));
            status_promise.catch(() => (status_promise = null));
        }
        return status_promise;
    },

    /** Whether the AI buttons should show; false when the status can't be read. */
    async enabled() {
        try {
            const status = await this.status();
            return !!(status && status.enabled);
        } catch (ex) {
            return false;
        }
    },

    /**
     * Rows for a table, not saved: `{ rows (keyed by field), columns, usage }`.
     * @param {number} file_id @param {{ prompt: string, count: number }} body
     */
    async generate_rows(file_id, body) {
        const res = await http.post(
            http.get_url(`/ai/web-file/${file_id}/generate-rows`),
            body
        );
        status_promise = null; // the usage changed
        return res;
    },

    /**
     * A new table's design and rows, not saved: `{ table_name, columns, rows, usage }`.
     * @param {{ description: string, row_count: number }} body
     */
    async preview_table(body) {
        const res = await http.post(http.get_url('/ai/table/preview'), body);
        status_promise = null;
        return res;
    },

    /**
     * Makes the previewed table; answers its id.
     * @param {{ table_name: string, columns: any[], rows: any[], parent_id?: number | null }} body
     */
    async create_table(body) {
        return http.post(http.get_url('/ai/table'), body);
    }
};
