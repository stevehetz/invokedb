// The admin's Status tab (#212): what the public /status page shows, and the incident note on
// it, which the admin sets or clears here.
import { defineComponent } from 'vue';
import { admin_http } from '@/core/context/admin/admin-http';
import { time_label } from '@/core/context/admin/admin';
import {
    INCIDENT_LABELS,
    OVERALL_LABELS,
    STATE_LABELS,
    ago_label
} from '@/core/context/status/status';

export default defineComponent({
    name: 'AdminStatus',

    data() {
        return {
            /** @type {any} */
            status: null,
            error: '',
            message: '',
            level: 'info',
            levels: Object.entries(INCIDENT_LABELS).map(([id, label]) => ({
                id,
                label
            })),
            busy: false,
            action_error: '',
            done: ''
        };
    },

    mounted() {
        this.load();
    },

    methods: {
        time_label,

        /** @param {number | null} ms */
        ago(ms) {
            return ago_label(ms);
        },

        /** @param {string} s */
        overall_label(s) {
            return OVERALL_LABELS[s] || s;
        },

        /** @param {string} s */
        state_label(s) {
            return STATE_LABELS[s] || s;
        },

        /** @param {string} s */
        level_label(s) {
            return INCIDENT_LABELS[s] || s;
        },

        async load() {
            this.error = '';
            try {
                this.status = await admin_http.status();
                const note = this.status.incident;
                this.message = note ? note.message : '';
                this.level = note ? note.level : 'info';
            } catch (ex) {
                this.error =
                    (ex && ex.message) || "The status couldn't be loaded.";
            }
        },

        async save() {
            await this.act(
                () =>
                    admin_http.set_incident({
                        message: this.message,
                        level: this.level
                    }),
                'The note is on the status page.'
            );
        },

        async clear() {
            await this.act(
                () => admin_http.clear_incident(),
                'The note is removed.'
            );
        },

        /** @param {() => Promise<any>} fn @param {string} done */
        async act(fn, done) {
            this.busy = true;
            this.action_error = '';
            this.done = '';
            try {
                await fn();
                this.done = done;
                await this.load();
            } catch (ex) {
                this.action_error =
                    (ex && ex.message) || "The note couldn't be saved.";
            } finally {
                this.busy = false;
            }
        }
    }
});
