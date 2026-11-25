// Ask your data (#149): a question about the table goes to the backend, which has Claude turn it
// into an /api/v1/query call, runs it read-only and answers. Shows the answer, the rows behind
// it and the API call, so the user can learn the API from it. Opened from the grid's top bar
// through `container-dialog:open` with `props: { file }`.
import { defineComponent } from 'vue';
import copy from 'copy-to-clipboard';
import { ai_http } from '@/core/context/ai/ai-http';
import { table_display_name } from '../table-name';

export const MAX_QUESTION_LENGTH = 500;

/** @param {any} ex @param {string} fallback */
function message_of(ex, fallback) {
    return (ex && ex.message) || fallback;
}

/** A cell as text: null as empty, anything else as it would print */
export function cell_text(value) {
    if (value === null || value === undefined) return '';
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
}

export default defineComponent({
    props: ['props'],

    data() {
        return {
            question: '',
            asking: false,
            /** @type {string | null} */
            error: null,
            /** @type {any} */
            result: null,
            /** @type {any} */
            usage: null,
            copied: false,
            /** @type {number | undefined} */
            copied_timer: undefined,
            max_length: MAX_QUESTION_LENGTH
        };
    },

    computed: {
        /** @returns {string} */
        table_name() {
            return table_display_name(this.props.file.name);
        },

        /** @returns {boolean} */
        can_ask() {
            const q = this.question.trim();
            return !this.asking && q !== '' && q.length <= MAX_QUESTION_LENGTH;
        },

        /** @returns {string[]} */
        columns() {
            return (this.result && this.result.columns) || [];
        },

        /** @returns {any[]} */
        rows() {
            return (this.result && this.result.rows) || [];
        },

        /** @returns {boolean} */
        used_up() {
            return !!this.usage && this.usage.used >= this.usage.limit;
        }
    },

    async mounted() {
        try {
            const status = await ai_http.status();
            this.usage = status && status.usage;
        } catch (ex) {
            this.error = message_of(ex, 'Could not load your AI usage');
        }
        const input = /** @type {HTMLElement | undefined} */ (
            this.$refs.question
        );
        if (input) input.focus();
    },

    beforeUnmount() {
        window.clearTimeout(this.copied_timer);
    },

    methods: {
        cell_text,

        async ask() {
            if (!this.can_ask) return;
            this.asking = true;
            this.error = null;
            try {
                const res = await ai_http.ask(
                    this.props.file.id,
                    this.question.trim()
                );
                this.result = res;
                if (res && res.usage) this.usage = res.usage;
            } catch (ex) {
                this.error = message_of(ex, 'Could not answer that question');
            }
            this.asking = false;
        },

        copy_call() {
            if (!this.result || !this.result.api_call) return;
            copy(this.result.api_call.curl);
            this.copied = true;
            window.clearTimeout(this.copied_timer);
            this.copied_timer = window.setTimeout(
                () => (this.copied = false),
                1500
            );
        }
    }
});
