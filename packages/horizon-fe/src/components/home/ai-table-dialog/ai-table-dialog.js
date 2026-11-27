// "New table from a description" (#148): the AI suggests a table name, columns (with types)
// and sample rows; the user can rename or retype the columns and drop rows, then creates the
// table. Opened by the Tables page through `container-dialog:open` with
// `props: { parent_id, on_created(table_id) }`.
import { defineComponent } from 'vue';
import { bus } from '@/core/bus';
import { ai_http } from '@/core/context/ai/ai-http';

/** @param {any} ex @param {string} fallback */
function message_of(ex, fallback) {
    return (ex && ex.message) || fallback;
}

/**
 * A preview value as the column's (possibly changed) type wants it, or null.
 * @param {any} value @param {string} type
 */
export function value_for_type(value, type) {
    if (value === null || value === undefined || value === '') return null;
    if (type === 'number') {
        const n = typeof value === 'number' ? value : Number(value);
        return Number.isFinite(n) ? n : null;
    }
    if (type === 'date') {
        return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)
            ? value
            : null;
    }
    return String(value);
}

export default defineComponent({
    props: ['props'],

    data() {
        return {
            description: '',
            row_count: 20,
            max_rows: 100,
            max_prompt_length: 1000,
            /** @type {{ month: string, used: number, limit: number } | null} */
            usage: null,
            generating: false,
            creating: false,
            /** @type {string | null} */
            error: null,
            // The preview: columns with the index of their values in each row
            table_name: '',
            /** @type {{ name: string, type: string }[] | null} */
            columns: null,
            /** @type {any[][]} */
            rows: [],
            // The tables the AI read for the rows (#324)
            /** @type {string[]} */
            read: []
        };
    },

    computed: {
        /** @returns {number} */
        left() {
            if (!this.usage) return this.max_rows;
            return Math.max(0, this.usage.limit - this.usage.used);
        },
        /** @returns {boolean} */
        can_generate() {
            return (
                !this.generating &&
                this.description.trim() !== '' &&
                Number.isInteger(this.row_count) &&
                this.row_count >= 0 &&
                this.row_count <= this.max_rows &&
                Math.max(1, this.row_count) <= this.left
            );
        },
        /** @returns {boolean} */
        can_create() {
            return (
                !!this.columns &&
                !this.creating &&
                this.table_name.trim() !== '' &&
                this.columns.length > 0 &&
                this.columns.every(c => c.name.trim() !== '')
            );
        }
    },

    async mounted() {
        try {
            const status = await ai_http.status();
            this.usage = status.rows;
            this.max_rows = status.limits.max_table_rows;
            this.max_prompt_length = status.limits.max_prompt_length;
        } catch (ex) {
            this.error = message_of(ex, 'Could not load the AI usage');
        }
        const input = /** @type {any} */ (this.$refs.description_input);
        if (input) input.focus();
    },

    methods: {
        async generate() {
            if (!this.can_generate) return;
            this.generating = true;
            this.error = null;
            try {
                const res = await ai_http.preview_table({
                    description: this.description.trim(),
                    row_count: this.row_count
                });
                this.usage = res.usage;
                this.table_name = res.table_name;
                /** @type {{ name: string, type: string }[]} */
                const cols = res.columns.map(
                    /** @param {any} c */ c => ({ name: c.name, type: c.type })
                );
                this.rows = res.rows.map(
                    /** @param {any} r */ r => cols.map(c => r[c.name])
                );
                this.read = Array.isArray(res.read) ? res.read : [];
                this.columns = cols;
            } catch (ex) {
                this.error = message_of(ex, 'Could not design the table');
            }
            this.generating = false;
        },

        start_over() {
            this.columns = null;
            this.rows = [];
            this.read = [];
            this.error = null;
        },

        /** @param {number} i */
        remove_row(i) {
            this.rows.splice(i, 1);
        },

        /** @param {number} i */
        remove_column(i) {
            if (!this.columns || this.columns.length <= 1) return;
            this.columns.splice(i, 1);
            this.rows.forEach(r => r.splice(i, 1));
        },

        /** @param {any} value @returns {string} */
        show(value) {
            return value === null || value === undefined ? '' : String(value);
        },

        async create() {
            if (!this.can_create || !this.columns) return;
            const columns = this.columns.map(c => ({
                name: c.name.trim(),
                type: c.type
            }));
            const rows = this.rows.map(r => {
                /** @type {Record<string, any>} */
                const row = {};
                columns.forEach((c, i) => {
                    row[c.name] = value_for_type(r[i], c.type);
                });
                return row;
            });
            this.creating = true;
            this.error = null;
            try {
                const id = await ai_http.create_table({
                    table_name: this.table_name.trim(),
                    columns,
                    rows,
                    parent_id: this.props.parent_id
                });
                bus.$emit('container-dialog:close');
                if (this.props.on_created) await this.props.on_created(id);
            } catch (ex) {
                this.error = message_of(ex, 'Could not create the table');
            }
            this.creating = false;
        }
    }
});
