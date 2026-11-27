// Link columns (#147). Opened from the grid through `container-dialog:open`, in one of two modes:
// - `settings`: which of the account's tables a link column points to, and which of its columns
//   names a linked row. props: { mode, file, link_table_id, link_display_field, on_save,
//   on_cancel }; on_save gets { link_table_id, link_display_field }.
// - `pick`: which rows of that table a cell links to, searched by the display column. props:
//   { mode, file, field, column_name, link_table_id, link_display_field,
//   selected: [{ _id, label }], on_save }; on_save gets the chosen [{ _id, label }]. The intro
//   names the linked table and its display column (#320), looked up in `link-targets`.
// Closing the dialog without saving calls on_cancel (if given).
import { defineComponent } from 'vue';
import { bus } from '@/core/bus';
import { web_file_http } from '@/core/context/web-file/web-file-http';

/** @param {any} ex @param {string} fallback */
function message_of(ex, fallback) {
    return (ex && ex.message) || fallback;
}

export default defineComponent({
    name: 'LinkDialog',

    props: ['props'],

    data() {
        return {
            loading: true,
            saving: false,
            /** @type {string | null} */
            error: null,
            saved: false,
            // settings
            /** @type {any[]} */
            tables: [],
            /** @type {number | null} */
            table_id: null,
            /** @type {string | null} */
            display_field: null,
            // pick
            /** @type {string[]} */
            chosen: [],
            /** @type {{ _id: string, label: string }[]} */
            options: [],
            searching: false,
            // The last search's text and how many rows it found
            last_q: '',
            found_count: 0
        };
    },

    computed: {
        /** @returns {boolean} */
        is_settings() {
            return this.props.mode === 'settings';
        },

        /** @returns {any[]} */
        table_columns() {
            const table = this.tables.find(t => t.id === this.table_id);
            return table ? table.columns : [];
        },

        /** @returns {any} */
        linked_table() {
            return (
                this.tables.find(t => t.id === this.props.link_table_id) || null
            );
        },

        /** @returns {string} The linked table's name (the column's, until it's known) */
        table_name() {
            if (this.linked_table) return this.linked_table.name;
            return this.props.column_name || 'the linked table';
        },

        /** @returns {string} */
        display_name() {
            const table = this.linked_table;
            if (!table) return '';
            const col = table.columns.find(
                (/** @type {any} */ c) =>
                    c.field === this.props.link_display_field
            );
            return col ? col.headerName : '';
        },

        /** @returns {string} */
        no_match_text() {
            return `No rows of ${this.table_name} match`;
        },

        /** @returns {boolean} A search for some text found nothing */
        no_match() {
            return (
                !this.searching &&
                this.last_q.trim() !== '' &&
                this.found_count === 0
            );
        },

        /** @returns {boolean} */
        can_save() {
            if (this.saving || this.loading) return false;
            return this.is_settings ? !!this.table_id : true;
        }
    },

    async mounted() {
        if (this.is_settings) {
            await this.load_tables();
        } else {
            const selected = this.props.selected || [];
            this.chosen = selected.map(s => s._id);
            this.options = selected.slice();
            this.loading = false;
            await Promise.all([this.load_names(), this.search('')]);
        }
    },

    beforeUnmount() {
        if (!this.saved && this.props.on_cancel) this.props.on_cancel();
    },

    methods: {
        async load_tables() {
            try {
                this.tables =
                    (await web_file_http.get_link_targets(
                        this.props.file.id
                    )) || [];
                this.table_id = this.props.link_table_id || null;
                if (!this.tables.some(t => t.id === this.table_id))
                    this.table_id = null;
                this.display_field = this.props.link_display_field || null;
                this.fix_display_field();
                this.error = null;
            } catch (ex) {
                this.error = message_of(ex, 'Could not load your tables');
            }
            this.loading = false;
        },

        // Pick mode: the linked table's and display column's names, for the intro. Without them
        // the intro names the column, so a failure here isn't shown.
        async load_names() {
            if (!this.props.link_table_id) return;
            try {
                this.tables =
                    (await web_file_http.get_link_targets(
                        this.props.file.id
                    )) || [];
            } catch (ex) {
                this.tables = [];
            }
        },

        // The display column has to be one of the chosen table's; its first by default
        fix_display_field() {
            const cols = this.table_columns;
            if (!cols.some(c => c.field === this.display_field)) {
                this.display_field = cols.length > 0 ? cols[0].field : null;
            }
        },

        table_changed() {
            this.fix_display_field();
        },

        /** @param {string} q */
        async search(q) {
            this.searching = true;
            try {
                const res = await web_file_http.get_link_options(
                    this.props.file.id,
                    this.props.field,
                    q
                );
                const found = (res && res.options) || [];
                this.last_q = q || '';
                this.found_count = found.length;
                // Keep the chosen rows' labels, so their tags still read right
                const kept = this.options.filter(o =>
                    this.chosen.includes(o._id)
                );
                const ids = new Set(kept.map(o => o._id));
                this.options = kept.concat(found.filter(o => !ids.has(o._id)));
                this.error = null;
            } catch (ex) {
                this.error = message_of(ex, 'Could not load the rows');
            }
            this.searching = false;
        },

        async save() {
            if (!this.can_save) return;
            this.saving = true;
            try {
                if (this.is_settings) {
                    await this.props.on_save({
                        link_table_id: this.table_id,
                        link_display_field: this.display_field
                    });
                } else {
                    const by_id = new Map(this.options.map(o => [o._id, o]));
                    await this.props.on_save(
                        this.chosen.map(
                            id => by_id.get(id) || { _id: id, label: id }
                        )
                    );
                }
                this.saved = true;
                bus.$emit('container-dialog:close');
            } catch (ex) {
                this.error = message_of(ex, 'Could not save');
            }
            this.saving = false;
        },

        cancel() {
            bus.$emit('container-dialog:close');
        }
    }
});
