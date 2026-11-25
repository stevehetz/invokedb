import { http } from '@/core/http';

// AI features (#149), signed in. Off unless the server has an Anthropic API key.
export const ai_http = {
    /** `{ available, usage: { month, used, limit, tier } }` */
    async status() {
        return http.get(http.get_url('/ai/status'));
    },

    /**
     * Ask a question about a table: `{ answer, rows, columns, total, api_call, usage }`
     * @param {number} table the table's id
     * @param {string} question
     */
    async ask(table, question) {
        return http.post(http.get_url('/ai/ask'), { table, question });
    }
};
