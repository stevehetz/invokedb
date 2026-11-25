// A kanban view (#146): a column per value of the view's group column, with a card per row
// (the view's filters and sort). Dragging a card to another column sets the row's group value
// through the ordinary row update, so the table's locks and webhooks apply.
import { defineComponent } from 'vue';
import { view_http } from '@/core/context/view/view-http';
import { web_file_http } from '@/core/context/web-file/web-file-http';

// Fields shown on a card besides its title
const CARD_FIELDS = 3;

/** @param {any} ex @param {string} fallback */
function message_of(ex, fallback) {
    return (ex && ex.message) || fallback;
}

/** @param {any} value */
function group_key(value) {
    return value === null || value === undefined
        ? '\u0000empty'
        : String(value);
}

export default defineComponent({
    props: ['view', 'file_directory_id', 'locked'],

    emits: ['saved'],

    data() {
        return {
            loading: true,
            /** @type {string | null} */
            error: null,
            /** @type {any[]} */
            groups: [],
            /** @type {any[]} */
            columns: [],
            group_field: '',
            truncated: false,
            /** @type {any} */
            dragging: null,
            /** @type {string | null} */
            drop_target: null,
            /** @type {string | null} */
            saving: null
        };
    },

    computed: {
        /** @returns {any[]} */
        card_columns() {
            const hidden = (this.view && this.view.hidden_fields) || [];
            return this.columns.filter(
                c =>
                    c.field !== this.group_field &&
                    c.type !== 'link' &&
                    !hidden.includes(c.field)
            );
        },

        /** @returns {any} */
        group_column() {
            return this.columns.find(c => c.field === this.group_field) || null;
        }
    },

    watch: {
        view() {
            this.load();
        }
    },

    mounted() {
        this.load();
    },

    methods: {
        async load() {
            this.loading = true;
            try {
                const res = await view_http.kanban(this.view.id);
                this.groups = (res.groups || []).map(g => ({
                    ...g,
                    key: group_key(g.value)
                }));
                this.columns = res.columns || [];
                this.group_field = res.group_field;
                this.truncated = !!res.truncated;
                this.error = null;
            } catch (ex) {
                this.error = message_of(ex, 'Could not load the board');
                this.groups = [];
            }
            this.loading = false;
        },

        /** @param {any} value */
        group_label(value) {
            return value === null || value === undefined || value === ''
                ? '(empty)'
                : String(value);
        },

        /** @param {any} row */
        card_title(row) {
            const c = this.card_columns[0];
            const v = c ? row[c.field] : null;
            return v === null || v === undefined || v === ''
                ? `Row ${row.row_index || ''}`.trim()
                : String(v);
        },

        /** @param {any} row */
        card_fields(row) {
            return this.card_columns
                .slice(1)
                .filter(
                    c =>
                        row[c.field] !== null &&
                        row[c.field] !== undefined &&
                        row[c.field] !== ''
                )
                .slice(0, CARD_FIELDS)
                .map(c => ({ name: c.name, value: String(row[c.field]) }));
        },

        /** @param {DragEvent} e @param {any} row @param {any} group */
        drag_start(e, row, group) {
            if (this.locked || this.saving) {
                e.preventDefault();
                return;
            }
            this.dragging = { row, from: group };
            if (e.dataTransfer) {
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', String(row._id));
            }
        },

        drag_end() {
            this.dragging = null;
            this.drop_target = null;
        },

        /** @param {DragEvent} e @param {any} group */
        drag_over(e, group) {
            if (!this.dragging) return;
            e.preventDefault();
            if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
            this.drop_target = group.key;
        },

        /** @param {any} group */
        drag_leave(group) {
            if (this.drop_target === group.key) this.drop_target = null;
        },

        /** @param {DragEvent} e @param {any} group */
        async drop(e, group) {
            e.preventDefault();
            const drag = this.dragging;
            this.drag_end();
            if (!drag || drag.from.key === group.key) return;
            await this.move(drag.row, drag.from, group);
        },

        // Moves the card at once, then saves; puts it back if the save fails
        /** @param {any} row @param {any} from @param {any} to */
        async move(row, from, to) {
            const field = this.group_field;
            const old_value = row[field];
            from.rows = from.rows.filter(r => r !== row);
            from.count--;
            to.rows.unshift(row);
            to.count++;
            row[field] = to.value;
            this.saving = String(row._id);
            try {
                const saved = await web_file_http.update(
                    'data_grid_row',
                    this.file_directory_id,
                    { web_doc_record: { _id: row._id, [field]: to.value } }
                );
                if (saved && saved._id) Object.assign(row, saved);
                this.$emit('saved');
            } catch (ex) {
                row[field] = old_value;
                to.rows = to.rows.filter(r => r !== row);
                to.count--;
                from.rows.unshift(row);
                from.count++;
                this.error = message_of(ex, 'Could not move the card');
            }
            this.saving = null;
        }
    }
});
