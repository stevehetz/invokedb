// The audit log (#217): who changed what, newest first, a page at a time. One table's (the
// grid's More menu, through `container-dialog:open` with `props: { file }`) or the whole
// account's (the Account page, `props: {}`).
import { defineComponent } from 'vue';
import { audit_http } from '@/core/context/audit/audit-http';
import { table_display_name } from '../h-data-grid/table-name';

const PAGE_SIZE = 50;

/** @type {Record<string, string>} */
const ACTOR_ICONS = {
    user: 'fa fa-user',
    api_key: 'fa fa-key',
    form: 'fa fa-list-alt'
};

/** @param {any} ex @param {string} fallback */
function message_of(ex, fallback) {
    return (ex && ex.message) || fallback;
}

export default defineComponent({
    props: ['props'],

    data() {
        return {
            /** @type {any[]} */
            entries: [],
            /** @type {string | null} */
            next_cursor: null,
            /** @type {number | null} */
            keep_days: null,
            loading: true,
            /** @type {string | null} */
            error: null
        };
    },

    computed: {
        /** @returns {any} the table, or null for the account's log */
        file() {
            return (this.props && this.props.file) || null;
        }
    },

    mounted() {
        this.load(false);
    },

    methods: {
        /** @param {boolean} more the next page, after the ones shown */
        async load(more) {
            this.loading = true;
            this.error = null;
            try {
                const res = await audit_http.list({
                    table: this.file ? this.file.id : null,
                    cursor: more ? this.next_cursor : null,
                    limit: PAGE_SIZE
                });
                const page = (res && res.entries) || [];
                this.entries = more ? [...this.entries, ...page] : page;
                this.next_cursor = (res && res.next_cursor) || null;
                this.keep_days = (res && res.keep_days) || null;
            } catch (ex) {
                this.error = message_of(ex, 'Could not read the history');
            } finally {
                this.loading = false;
            }
        },

        /** @param {number} at */
        when(at) {
            return new Date(at).toLocaleString();
        },

        /** @param {any} entry */
        actor_icon(entry) {
            return ACTOR_ICONS[entry.actor && entry.actor.type] || 'fa fa-user';
        },

        /** @param {any} entry */
        table_label(entry) {
            return entry.table_name ? table_display_name(entry.table_name) : '';
        }
    }
});
