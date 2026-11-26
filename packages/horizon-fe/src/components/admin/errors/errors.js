// The admin's Errors page (#212): the backend's and the frontend's unhandled errors, grouped
// by fingerprint, last seen first. Opening one shows its latest stack; a frontend stack is
// mapped to the source files through the build's hidden source maps.
import { defineComponent } from 'vue';
import { admin_http } from '@/core/context/admin/admin-http';
import { count_label, time_label } from '@/core/context/admin/admin';
import { resolve_stack } from '@/core/context/admin/source-map';

const PAGE_SIZE = 25;

export const ERROR_SOURCES = [
    { id: '', label: 'Every source' },
    { id: 'api', label: 'API' },
    { id: 'processor', label: 'Processor' },
    { id: 'frontend', label: 'Frontend' }
];

/** @param {string} url */
async function load_map(url) {
    const res = await fetch(`${url}.map`);
    return res.ok ? res.json() : null;
}

export default defineComponent({
    name: 'AdminErrors',

    props: ['error_id'],

    emits: ['open', 'close', 'account'],

    data() {
        return {
            /** @type {any} */
            list: null,
            list_error: '',
            loading: false,
            query: { source: '', page: 1 },
            sources: ERROR_SOURCES,
            /** @type {any} */
            detail: null,
            detail_error: '',
            /** The stack mapped to the source files, when the maps could be read */
            mapped_stack: '',
            show_raw: false
        };
    },

    computed: {
        /** @returns {number} */
        pages() {
            if (!this.list) return 1;
            return Math.max(1, Math.ceil(this.list.total / this.list.limit));
        },

        /** @returns {string} */
        stack() {
            if (!this.detail) return '';
            if (this.mapped_stack && !this.show_raw) return this.mapped_stack;
            return this.detail.stack || '';
        }
    },

    watch: {
        error_id: {
            immediate: true,
            handler(id) {
                if (id) this.load_detail(id);
                else {
                    this.detail = null;
                    if (!this.list) this.load_list();
                }
            }
        }
    },

    methods: {
        count_label,
        time_label,

        async load_list() {
            this.loading = true;
            this.list_error = '';
            try {
                this.list = await admin_http.errors({
                    ...this.query,
                    limit: PAGE_SIZE
                });
            } catch (ex) {
                this.list_error =
                    (ex && ex.message) || "The errors couldn't be loaded.";
            } finally {
                this.loading = false;
            }
        },

        /** @param {string} id */
        async load_detail(id) {
            this.detail = null;
            this.detail_error = '';
            this.mapped_stack = '';
            this.show_raw = false;
            try {
                this.detail = await admin_http.error(id);
            } catch (ex) {
                this.detail_error =
                    (ex && ex.message) || "The error couldn't be loaded.";
                return;
            }
            if (this.detail.source === 'frontend' && this.detail.stack) {
                try {
                    const res = await resolve_stack(
                        this.detail.stack,
                        window.location.origin,
                        load_map
                    );
                    if (res.mapped > 0) this.mapped_stack = res.text;
                } catch {
                    // The raw stack is shown
                }
            }
        },

        filter_changed() {
            this.query.page = 1;
            this.load_list();
        },

        /** @param {number} delta */
        go_page(delta) {
            const page = this.query.page + delta;
            if (page < 1 || page > this.pages) return;
            this.query.page = page;
            this.load_list();
        },

        /** @param {string} source */
        source_label(source) {
            const s = ERROR_SOURCES.find(x => x.id === source);
            return s ? s.label : source;
        },

        /** @param {any} e */
        where(e) {
            return e.route || e.page || '';
        }
    }
});
