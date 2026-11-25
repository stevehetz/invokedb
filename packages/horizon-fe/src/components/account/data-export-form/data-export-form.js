// Data export (#215): ask for a zip of every table (CSV and JSON) and the forms, views and
// webhooks settings, wait while the server prepares it, then download it within 24 hours.
import { defineComponent } from 'vue';
import { bus } from '@/core/bus';
import { account_export_http } from '@/core/context/account-export/account-export-http';

// How often to ask how a pending export is going
const POLL_MS = 3000;

function error_message(ex, fallback) {
    if (ex && typeof ex.message === 'string') return ex.message;
    if (ex && Array.isArray(ex.message)) return ex.message.join(', ');
    return fallback;
}

/** @param {number} bytes */
export function size_label(bytes) {
    if (!bytes && bytes !== 0) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default defineComponent({
    name: 'DataExportForm',

    data() {
        return {
            loading: true,
            /** @type {any} */
            current: null,
            requesting: false,
            downloading: false,
            /** @type {number | null} */
            poll_timer: null
        };
    },

    computed: {
        status() {
            return this.current ? this.current.status : null;
        },

        preparing() {
            return this.status === 'pending' || this.status === 'running';
        },

        ready() {
            return this.status === 'ready';
        },

        summary() {
            const e = this.current;
            if (!e || !this.ready) return '';
            const tables = `${e.tables} ${e.tables === 1 ? 'table' : 'tables'}`;
            const rows = `${e.rows} ${e.rows === 1 ? 'row' : 'rows'}`;
            return `${tables}, ${rows}, ${size_label(e.size)}`;
        }
    },

    mounted() {
        this.load();
    },

    beforeUnmount() {
        this.stop_polling();
    },

    methods: {
        time(value) {
            return value ? new Date(value).toLocaleString() : '';
        },

        stop_polling() {
            if (this.poll_timer) window.clearTimeout(this.poll_timer);
            this.poll_timer = null;
        },

        poll_if_preparing() {
            this.stop_polling();
            if (this.preparing) {
                this.poll_timer = window.setTimeout(() => this.load(), POLL_MS);
            }
        },

        async load() {
            try {
                const res = await account_export_http.status();
                this.current = res ? res.export : null;
            } catch (ex) {
                // Keep what's shown; the next poll tries again
            }
            this.loading = false;
            this.poll_if_preparing();
        },

        async request_export() {
            if (this.requesting || this.preparing) return;
            this.requesting = true;
            try {
                const res = await account_export_http.request();
                this.current = res ? res.export : null;
                this.poll_if_preparing();
            } catch (ex) {
                bus.$emit(
                    'notify:error',
                    error_message(ex, "Couldn't start the export")
                );
            }
            this.requesting = false;
        },

        async download() {
            if (!this.ready || this.downloading) return;
            this.downloading = true;
            try {
                const day = new Date(this.current.created_at)
                    .toISOString()
                    .slice(0, 10);
                await account_export_http.download(
                    this.current.id,
                    `invokedb-export-${day}.zip`
                );
            } catch (ex) {
                bus.$emit(
                    'notify:error',
                    error_message(ex, "Couldn't download the export")
                );
                await this.load();
            }
            this.downloading = false;
        }
    }
});
