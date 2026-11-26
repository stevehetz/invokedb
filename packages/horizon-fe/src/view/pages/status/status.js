import { store } from '@/store';
import {
    CHECK_NOTES,
    INCIDENT_LABELS,
    OVERALL_LABELS,
    STATE_LABELS,
    ago_label,
    status_http
} from '@/core/context/status/status';

// The answer is cached on the server for 30 seconds; the page reads it again every minute
const REFRESH_MS = 60 * 1000;

// The public status page (#212), from the backend's own checks (GET /status). If the API can't
// be reached at all, that is the outage.
export default {
    name: 'Status',

    data() {
        return {
            account: null,
            /** @type {any} */
            status: null,
            unreachable: false,
            loading: true,
            now: Date.now(),
            /** @type {number | undefined} */
            timer: undefined,
            /** @type {any} */
            account_sub: null
        };
    },

    computed: {
        /** @returns {string} */
        overall() {
            if (this.unreachable) return 'outage';
            return this.status ? this.status.status : '';
        },

        /** @returns {string} */
        headline() {
            if (this.unreachable) return "The API can't be reached";
            return OVERALL_LABELS[this.overall] || '';
        }
    },

    mounted() {
        this.account_sub = store.subscribe('account', account => {
            this.account = account;
        });
        this.load();
        this.timer = window.setInterval(() => this.load(), REFRESH_MS);
    },

    beforeUnmount() {
        window.clearInterval(this.timer);
        if (this.account_sub) this.account_sub.unsubscribe();
    },

    methods: {
        async load() {
            try {
                this.status = await status_http.status();
                this.unreachable = false;
            } catch (ex) {
                this.unreachable = true;
            } finally {
                this.loading = false;
                this.now = Date.now();
            }
        },

        /** @param {string} state */
        state_label(state) {
            return STATE_LABELS[state] || state;
        },

        /** @param {string} id */
        check_note(id) {
            return CHECK_NOTES[id] || '';
        },

        /** @param {string} level */
        incident_label(level) {
            return INCIDENT_LABELS[level] || level;
        },

        /** @param {number | null} ms */
        ago(ms) {
            return ago_label(ms, this.now);
        },

        /** @param {number | null} ms */
        time_label(ms) {
            return ms ? new Date(ms).toLocaleString() : '';
        }
    }
};
