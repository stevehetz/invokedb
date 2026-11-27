// Link columns (#147). Opened from the grid through `container-dialog:open`, in one of two modes:
// - `settings`: which of the account's tables a link column points to, and which of its columns
//   names a linked row. props: { mode, file, link_table_id, link_display_field, on_save,
//   on_cancel }; on_save gets { link_table_id, link_display_field }.
// - `pick`: which rows of that table a cell links to, searched by the display column. props:
//   { mode, file, field, column_name, link_table_id, link_display_field,
//   selected: [{ _id, label }], on_save }; on_save gets the chosen [{ _id, label }]. The intro
//   names the linked table and its display column (#320), looked up in `link-targets`.
//   Settings mode also fills the column by matching (#321), once it's saved as a link to the
//   chosen table: props `field` and `saved_link_table_id` say so, and `on_matched` is called
//   after rows were linked, to refresh the grid.
// Closing the dialog without saving calls on_cancel (if given).
import { defineComponent } from 'vue';
import { bus } from '@/core/bus';
import { web_file_http } from '@/core/context/web-file/web-file-http';

/** @param {number} n @returns {string} */
function rows_text(n) {
    return n === 1 ? '1 row' : `${n} rows`;
}

/**
 * A column of each list with the same name, ignoring case, if there is one
 * @param {any[]} cols @param {any[]} others
 * @returns {[string | null, string | null]}
 */
function same_named(cols, others) {
    for (const c of cols) {
        const name = String(c.headerName).trim().toLowerCase();
        const other = others.find(
            o => String(o.headerName).trim().toLowerCase() === name
        );
        if (other) return [c.field, other.field];
    }
    return [null, null];
}

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
            // settings: fill by matching (#321)
            /** @type {string | null} */
            source_field: null,
            /** @type {string | null} */
            target_field: null,
            /** @type {{ linked: number, no_match: number, multiple: number, already_linked: number } | null} */
            match_counts: null,
            // What the last Link rows did
            match_done: '',
            matching: false,
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

        /** @returns {boolean} The column is saved as a link to the chosen table */
        can_match() {
            const saved = this.props.saved_link_table_id;
            return (
                !!this.props.field &&
                saved !== null &&
                saved !== undefined &&
                Number(saved) === Number(this.table_id)
            );
        },

        /** @returns {any[]} This table's columns a match can be made on */
        source_columns() {
            const own = this.tables.find(
                t => Number(t.id) === Number(this.props.file.id)
            );
            return ((own && own.columns) || []).filter(
                (/** @type {any} */ c) =>
                    c.col_type !== 'link' && c.field !== this.props.field
            );
        },

        /** @returns {any[]} The linked table's columns a match can be made on */
        target_columns() {
            return this.table_columns.filter(
                (/** @type {any} */ c) => c.col_type !== 'link'
            );
        },

        /** @returns {string} */
        target_table_name() {
            const table = this.tables.find(t => t.id === this.table_id);
            return table ? table.name : 'the linked table';
        },

        /** @returns {boolean} */
        can_find() {
            return (
                this.can_match &&
                !!this.source_field &&
                !!this.target_field &&
                !this.matching &&
                !this.saving
            );
        },

        /** @returns {boolean} */
        can_apply() {
            return (
                this.can_find &&
                !!this.match_counts &&
                this.match_counts.linked > 0
            );
        },

        /** @returns {string} The preview's counts, in words */
        match_summary() {
            const c = this.match_counts;
            if (!c) return '';
            const parts = [
                c.linked === 0
                    ? 'No rows will be linked'
                    : `${rows_text(c.linked)} will be linked`
            ];
            if (c.multiple > 0) {
                const verb = c.multiple === 1 ? 'matches' : 'match';
                parts.push(
                    `${rows_text(c.multiple)} ${verb} more than one row (linked to all of them)`
                );
            }
            if (c.no_match > 0) {
                const verb = c.no_match === 1 ? 'has' : 'have';
                parts.push(`${rows_text(c.no_match)} ${verb} no match`);
            }
            if (c.already_linked > 0) {
                const verb = c.already_linked === 1 ? 'has' : 'have';
                parts.push(
                    `${rows_text(c.already_linked)} already ${verb} links and stay as they are`
                );
            }
            return `${parts.join(', ')}.`;
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
                this.default_match_fields();
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
            this.default_match_fields();
        },

        // Fill by matching: a same-named column of each table by default (Email ↔ Email)
        default_match_fields() {
            const [source, target] = same_named(
                this.source_columns,
                this.target_columns
            );
            this.source_field = source;
            this.target_field = target;
            this.match_changed();
        },

        match_changed() {
            this.match_counts = null;
            this.match_done = '';
        },

        /**
         * @param {boolean} apply
         * @returns {Promise<any>} the counts, or null if it failed
         */
        async run_match(apply) {
            if (!this.can_find) return null;
            this.matching = true;
            try {
                const counts = await web_file_http.link_match(
                    this.props.file.id,
                    {
                        field: this.props.field,
                        source_field: String(this.source_field),
                        target_field: String(this.target_field),
                        apply
                    }
                );
                this.error = null;
                return counts;
            } catch (ex) {
                this.error = message_of(ex, 'Could not match the rows');
                return null;
            } finally {
                this.matching = false;
            }
        },

        async find_matches() {
            this.match_done = '';
            const counts = await this.run_match(false);
            if (counts) this.match_counts = counts;
        },

        async apply_matches() {
            if (!this.can_apply) return;
            const counts = await this.run_match(true);
            if (!counts) return;
            this.match_counts = null;
            this.match_done =
                counts.linked === 0
                    ? 'No rows were linked.'
                    : `Linked ${rows_text(counts.linked)}.`;
            if (this.props.on_matched) this.props.on_matched();
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
