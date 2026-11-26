// AI columns (#205): make a column of the table one the AI fills per row from a prompt over
// other columns ("Summarise the notes"), fill it after confirming the AI rows it will use, and
// see how it's going. Opened from the grid's More menu through `container-dialog:open` with
// `props: { file, on_change }`; `on_change(columns)` tells the grid which columns are AI
// columns (it shows their notes) after any change.
import { defineComponent } from 'vue';
import { ai_column_http } from '@/core/context/ai-column/ai-column-http';
import { web_file_http } from '@/core/context/web-file/web-file-http';

/** @param {any} ex @param {string} fallback */
function message_of(ex, fallback) {
    return (ex && ex.message) || fallback;
}

/** @param {any} c */
const live = c =>
    c && !c.deleted && typeof c.headerName === 'string' && c.headerName !== '';

export default defineComponent({
    props: ['props'],

    data() {
        return {
            /** @type {any[]} */
            ai_columns: [],
            /** @type {any[]} the table's columns */
            columns: [],
            limits: {
                max_prompt_length: 1000,
                max_inputs: 10,
                max_per_table: 5
            },
            loading: true,
            /** @type {string | null} */
            error: null,
            // The form: a new AI column, or the one being changed
            field: '',
            prompt: '',
            /** @type {string[]} */
            inputs: [],
            saving: false,
            /** @type {string | null} the field whose fill is being confirmed or started */
            busy: null,
            /** @type {{ field: string, rows: number, empty: number, left: number, limit: number, available: boolean } | null} */
            confirm: null,
            /** @type {number | undefined} */
            poll_timer: undefined
        };
    },

    computed: {
        /** @returns {any[]} columns that can be filled or read: not links */
        plain_columns() {
            return this.columns.filter(c => c.col_type !== 'link');
        },

        /** @returns {any[]} what the AI column can read: not itself, not another AI column */
        input_choices() {
            const ai = new Set(
                this.ai_columns.map(c => c.field).filter(f => f !== this.field)
            );
            return this.plain_columns.filter(
                c => c.field !== this.field && !ai.has(c.field)
            );
        },

        /** @returns {boolean} */
        editing() {
            return this.ai_columns.some(c => c.field === this.field);
        },

        /** @returns {boolean} */
        can_save() {
            return (
                !this.saving &&
                this.field !== '' &&
                this.prompt.trim() !== '' &&
                this.inputs.length > 0
            );
        }
    },

    async mounted() {
        await this.load();
    },

    beforeUnmount() {
        window.clearTimeout(this.poll_timer);
    },

    methods: {
        async load() {
            try {
                const [res, cols] = await Promise.all([
                    ai_column_http.list(this.props.file.id),
                    web_file_http.get_by_id(
                        this.props.file.id,
                        'data_grid_column'
                    )
                ]);
                this.ai_columns = (res && res.columns) || [];
                if (res && res.limits) this.limits = res.limits;
                this.columns = ((cols && cols.data) || [])
                    .filter(live)
                    .sort((a, b) => (a.order || 0) - (b.order || 0));
                this.error = null;
                this.changed();
            } catch (ex) {
                this.error = message_of(ex, 'Could not load the AI columns');
            }
            this.loading = false;
            this.schedule_poll();
        },

        // While a column is filling, its state is read again every few seconds
        schedule_poll() {
            window.clearTimeout(this.poll_timer);
            if (!this.ai_columns.some(c => c.state === 'filling')) return;
            this.poll_timer = window.setTimeout(() => this.load(), 4000);
        },

        changed() {
            if (this.props.on_change) this.props.on_change(this.ai_columns);
        },

        /** @param {string} field */
        column_name(field) {
            const c = this.columns.find(col => col.field === field);
            return c ? c.headerName : field;
        },

        /** @param {any} c */
        status(c) {
            if (c.state === 'filling') return 'Filling...';
            if (c.state === 'stopped') {
                return `Stopped: ${c.note || 'it could not go on'}`;
            }
            if (c.state === 'done') {
                return `Filled; it fills again when a row's ${c.inputs
                    .map(f => this.column_name(f))
                    .join(', ')} changes`;
            }
            return c.auto ? 'Filled' : 'Not filled yet';
        },

        new_column() {
            this.field = '';
            this.prompt = '';
            this.inputs = [];
            this.confirm = null;
        },

        /** @param {any} c */
        edit(c) {
            this.field = c.field;
            this.prompt = c.prompt;
            this.inputs = [...c.inputs];
            this.confirm = null;
        },

        field_changed() {
            this.inputs = this.inputs.filter(f => f !== this.field);
            const existing = this.ai_columns.find(c => c.field === this.field);
            if (existing) this.edit(existing);
        },

        async save() {
            if (!this.can_save) return;
            this.saving = true;
            try {
                const res = await ai_column_http.save({
                    table: this.props.file.id,
                    field: this.field,
                    prompt: this.prompt.trim(),
                    inputs: this.inputs
                });
                const saved = res && res.column;
                if (saved) {
                    const others = this.ai_columns.filter(
                        c => c.field !== saved.field
                    );
                    this.ai_columns = [...others, saved];
                    this.changed();
                    // Straight on to how many rows filling it would use
                    await this.ask_fill(saved);
                }
                this.error = null;
            } catch (ex) {
                this.error = message_of(ex, 'Could not save the AI column');
            }
            this.saving = false;
        },

        /** Shows what filling the column would use, to confirm. @param {any} c */
        async ask_fill(c) {
            this.busy = c.field;
            try {
                const est = await ai_column_http.estimate(
                    this.props.file.id,
                    c.field
                );
                this.confirm = { field: c.field, ...est };
                this.error = null;
            } catch (ex) {
                this.error = message_of(ex, 'Could not count the rows');
            }
            this.busy = null;
        },

        async fill() {
            if (!this.confirm) return;
            const field = this.confirm.field;
            this.busy = field;
            try {
                const res = await ai_column_http.fill(
                    this.props.file.id,
                    field
                );
                if (res && res.column) {
                    this.ai_columns = this.ai_columns.map(c =>
                        c.field === field ? res.column : c
                    );
                    this.changed();
                }
                this.confirm = null;
                this.error = null;
                this.schedule_poll();
            } catch (ex) {
                this.error = message_of(ex, 'Could not fill the column');
            }
            this.busy = null;
        },

        /** The column stays, with its values; the AI no longer fills it. @param {any} c */
        async remove(c) {
            this.busy = c.field;
            try {
                await ai_column_http.remove(this.props.file.id, c.field);
                this.ai_columns = this.ai_columns.filter(
                    x => x.field !== c.field
                );
                if (this.field === c.field) this.new_column();
                if (this.confirm && this.confirm.field === c.field) {
                    this.confirm = null;
                }
                this.changed();
                this.error = null;
            } catch (ex) {
                this.error = message_of(ex, 'Could not remove the AI column');
            }
            this.busy = null;
        }
    }
});
