// "Generate rows" (#148): describe the rows and the AI makes them for the table's columns. They
// aren't saved here: `props.on_generated(rows)` shows them in the grid as new rows, to edit or
// delete, and the grid's Save inserts them. Opened from the grid's top bar through
// `container-dialog:open` with `props: { file, on_generated }`.
import { defineComponent } from 'vue';
import { bus } from '@/core/bus';
import { ai_http } from '@/core/context/ai/ai-http';

/** @param {any} ex @param {string} fallback */
function message_of(ex, fallback) {
    return (ex && ex.message) || fallback;
}

export default defineComponent({
    props: ['props'],

    data() {
        return {
            prompt: '',
            count: 10,
            max_count: 500,
            max_prompt_length: 1000,
            /** @type {{ month: string, used: number, limit: number } | null} */
            usage: null,
            generating: false,
            /** @type {string | null} */
            error: null
        };
    },

    computed: {
        /** @returns {number} */
        left() {
            if (!this.usage) return this.max_count;
            return Math.max(0, this.usage.limit - this.usage.used);
        },
        /** @returns {boolean} */
        can_generate() {
            return (
                !this.generating &&
                this.prompt.trim() !== '' &&
                Number.isInteger(this.count) &&
                this.count >= 1 &&
                this.count <= this.max_count &&
                this.count <= this.left
            );
        }
    },

    async mounted() {
        try {
            const status = await ai_http.status();
            this.usage = status.rows;
            this.max_count = status.limits.max_rows_per_request;
            this.max_prompt_length = status.limits.max_prompt_length;
        } catch (ex) {
            this.error = message_of(ex, 'Could not load the AI usage');
        }
        const input = /** @type {any} */ (this.$refs.prompt_input);
        if (input) input.focus();
    },

    methods: {
        async generate() {
            if (!this.can_generate) return;
            this.generating = true;
            this.error = null;
            try {
                const res = await ai_http.generate_rows(this.props.file.id, {
                    prompt: this.prompt.trim(),
                    count: this.count
                });
                this.usage = res.usage;
                if (this.props.on_generated) this.props.on_generated(res.rows);
                bus.$emit('container-dialog:close');
            } catch (ex) {
                this.error = message_of(ex, 'Could not generate rows');
            }
            this.generating = false;
        }
    }
});
