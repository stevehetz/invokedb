// A table's webhooks (#140): add one (for this table or every table), send a test event,
// disable, delete, and read its delivery log. Opened from the grid's top bar through
// `container-dialog:open` with `props: { file }`.
import { defineComponent } from 'vue';
import copy from 'copy-to-clipboard';
import { bus } from '@/core/bus';
import { webhook_http } from '@/core/context/webhook/webhook-http';
import { table_display_name } from '../table-name';

const EVENTS = ['row.created', 'row.updated', 'row.deleted'];

/** @param {any} ex */
function message_of(ex, fallback) {
    return (ex && ex.message) || fallback;
}

export default defineComponent({
    props: ['props'],

    data() {
        return {
            /** @type {any[]} */
            webhooks: [],
            events: EVENTS,
            loading: true,
            /** @type {string | null} */
            error: null,
            new_url: '',
            /** @type {string[]} */
            new_events: [...EVENTS],
            new_all_tables: false,
            adding: false,
            /** @type {string | null} */
            busy: null,
            /** @type {string | null} */
            shown_secret: null,
            /** @type {string | null} */
            copied: null,
            /** @type {number | undefined} */
            copied_timer: undefined,
            /** @type {string | null} */
            open_log: null,
            /** @type {any[]} */
            log: [],
            log_loading: false,
            /** @type {string | null} */
            open_delivery: null
        };
    },

    computed: {
        /**
         * The table's name as the dialog's title shows it (no `.g`)
         * @returns {string}
         */
        table_name() {
            return table_display_name(this.props.file.name);
        },

        /** @returns {boolean} */
        can_add() {
            return (
                !this.adding &&
                this.new_url.trim() !== '' &&
                this.new_events.length > 0
            );
        }
    },

    async mounted() {
        await this.load();
    },

    beforeUnmount() {
        window.clearTimeout(this.copied_timer);
    },

    methods: {
        async load() {
            try {
                const res = await webhook_http.list(this.props.file.id);
                this.webhooks = (res && res.webhooks) || [];
                this.error = null;
            } catch (ex) {
                this.error = message_of(ex, 'Could not load the webhooks');
            }
            this.loading = false;
        },

        /** @param {any} hook */
        replace(hook) {
            this.webhooks = this.webhooks.map(h =>
                h.id === hook.id ? hook : h
            );
        },

        async add_webhook() {
            if (!this.can_add) return;
            this.adding = true;
            try {
                const hook = await webhook_http.create({
                    url: this.new_url.trim(),
                    events: this.new_events,
                    file_id: this.new_all_tables ? null : this.props.file.id
                });
                this.webhooks = [...this.webhooks, hook];
                this.new_url = '';
                this.shown_secret = hook.id;
                this.error = null;
            } catch (ex) {
                this.error = message_of(ex, 'Could not add the webhook');
            }
            this.adding = false;
        },

        /** @param {any} hook */
        async send_test(hook) {
            this.busy = `${hook.id}:test`;
            try {
                await webhook_http.test(hook.id);
                this.error = null;
                this.show_log(hook);
                // The processor sends it within a few seconds
                window.setTimeout(() => {
                    if (this.open_log === hook.id) this.load_log(hook);
                }, 3000);
                await this.load_log(hook);
            } catch (ex) {
                this.error = message_of(ex, 'Could not send a test event');
            }
            this.busy = null;
        },

        /** @param {any} hook */
        async toggle_enabled(hook) {
            try {
                this.replace(
                    await webhook_http.update(hook.id, {
                        enabled: !hook.enabled
                    })
                );
                this.error = null;
            } catch (ex) {
                this.error = message_of(ex, 'Could not change the webhook');
            }
        },

        /** @param {any} hook */
        remove(hook) {
            // The message is HTML, so it doesn't include the URL
            bus.$emit('confirm-dialog:open', {
                title: 'Delete webhook',
                message:
                    'Delete this webhook and its delivery log? Its URL gets no more deliveries.',
                callback: async () => {
                    try {
                        await webhook_http.remove(hook.id);
                        this.webhooks = this.webhooks.filter(
                            h => h.id !== hook.id
                        );
                        if (this.open_log === hook.id) this.open_log = null;
                        this.error = null;
                    } catch (ex) {
                        this.error = message_of(
                            ex,
                            'Could not delete the webhook'
                        );
                    }
                }
            });
        },

        /** @param {any} hook */
        async toggle_log(hook) {
            if (this.open_log === hook.id) {
                this.open_log = null;
                return;
            }
            this.show_log(hook);
            await this.load_log(hook);
        },

        /** @param {any} hook */
        show_log(hook) {
            if (this.open_log !== hook.id) this.log = [];
            this.open_log = hook.id;
        },

        /** @param {any} hook */
        async load_log(hook) {
            this.log_loading = this.log.length === 0;
            try {
                const res = await webhook_http.deliveries(hook.id);
                if (this.open_log === hook.id)
                    this.log = (res && res.deliveries) || [];
            } catch (ex) {
                this.error = message_of(ex, 'Could not load the deliveries');
            }
            this.log_loading = false;
        },

        /** @param {any} hook */
        copy_secret(hook) {
            copy(hook.secret);
            this.copied = hook.id;
            window.clearTimeout(this.copied_timer);
            this.copied_timer = window.setTimeout(
                () => (this.copied = null),
                1500
            );
        },

        /** @param {number} time */
        format_time(time) {
            return time ? new Date(time).toLocaleString() : '';
        },

        /** @param {any} value */
        pretty(value) {
            return JSON.stringify(value, null, 2);
        }
    }
});
