// The onboarding checklist (#143): from a new account to a working API call. The backend keeps
// the progress (GET /onboarding): "create a table" ticks when the account has one, "see your API
// key" when the key is shown (here or on the Account page), "copy the command" when it's copied
// here, and "call the API" when /api/v1 answers a call made with the key. Dismissed, it's gone
// for good.
import { defineComponent } from 'vue';
import copy from 'copy-to-clipboard';
import { store } from '@/store';
import { bus } from '@/core/bus';
import { onboarding_http } from '@/core/context/onboarding/onboarding-http';

// How often to look for the API call while the checklist waits for it
const POLL_MS = 5000;

const TITLES = {
    create_table: 'Create a table',
    view_api_key: 'See your API key',
    copy_command: 'Copy a ready-made curl command',
    call_api: 'Run it and see the response'
};

function pretty(text) {
    try {
        return JSON.stringify(JSON.parse(text), null, 2);
    } catch (ex) {
        return text || '(no body)';
    }
}

export default defineComponent({
    name: 'Onboarding',

    // The tree, so a new or deleted table refreshes the checklist
    props: ['tree_items'],

    emits: ['add_table'],

    data() {
        return {
            view: null,
            collapsed: false,
            key_shown: false,
            copied: false,
            copied_timer: null,
            poll_timer: null,
            running: false,
            response: null
        };
    },

    computed: {
        visible() {
            return !!this.view && this.view.show;
        },

        steps() {
            if (!this.view) return [];
            return this.view.steps.map(s => ({ ...s, title: TITLES[s.id] }));
        },

        done_count() {
            return this.steps.filter(s => s.done).length;
        },

        api_key() {
            const account = store.get('account') || {};
            return account.api_key || '';
        },

        // Waiting for the call: the command is out there, the call hasn't come in yet
        waiting_for_call() {
            return (
                this.visible && !!this.view.first_call && !this.done('call_api')
            );
        }
    },

    watch: {
        tree_items() {
            this.refresh();
        },

        waiting_for_call(waiting) {
            if (waiting) this.start_polling();
            else this.stop_polling();
        }
    },

    mounted() {
        bus.$on('onboarding:changed', this.set_view);
        window.addEventListener('focus', this.refresh);
        this.refresh();
    },

    beforeUnmount() {
        bus.$off('onboarding:changed', this.set_view);
        window.removeEventListener('focus', this.refresh);
        this.stop_polling();
        window.clearTimeout(this.copied_timer);
    },

    methods: {
        set_view(view) {
            if (view && Array.isArray(view.steps)) this.view = view;
        },

        async refresh() {
            try {
                await onboarding_http.get();
            } catch (ex) {
                // The checklist is optional: never get in the way of the app
            }
        },

        done(id) {
            const step = this.steps.find(s => s.id === id);
            return !!step && step.done;
        },

        start_polling() {
            this.stop_polling();
            this.poll_timer = window.setInterval(() => {
                if (document.visibilityState === 'visible') this.refresh();
            }, POLL_MS);
        },

        stop_polling() {
            window.clearInterval(this.poll_timer);
            this.poll_timer = null;
        },

        async mark(step) {
            if (this.done(step)) return;
            try {
                await onboarding_http.mark(step);
            } catch (ex) {
                // as in refresh()
            }
        },

        add_table(type) {
            this.$emit('add_table', type);
        },

        show_key() {
            this.key_shown = true;
            this.mark('view_api_key');
        },

        copy_command() {
            copy(this.view.first_call.command);
            this.copied = true;
            window.clearTimeout(this.copied_timer);
            this.copied_timer = window.setTimeout(
                () => (this.copied = false),
                1500
            );
            this.mark('copy_command');
        },

        // The same GET as the command, from the browser, for anyone without a terminal
        async run_here() {
            const call = this.view.first_call;
            this.running = true;
            try {
                const res = await fetch(call.url, {
                    headers: { Authorization: `Bearer ${this.api_key}` }
                });
                const text = await res.text();
                this.response = {
                    ok: res.ok,
                    status: res.status,
                    body: pretty(text)
                };
            } catch (ex) {
                this.response = {
                    ok: false,
                    status: 'Failed',
                    body: `The request failed: ${ex.message}`
                };
            }
            this.running = false;
            this.refresh();
        },

        dismiss() {
            bus.$emit('confirm-dialog:open', {
                title: 'Hide the checklist',
                message:
                    'Hide the getting-started checklist for good? The <b>Api</b> and <b>Guide</b> pages cover the same ground.',
                callback: async () => {
                    try {
                        await onboarding_http.dismiss();
                    } catch (ex) {
                        bus.$emit(
                            'notify:error',
                            "Couldn't hide the checklist"
                        );
                    }
                }
            });
        }
    }
});
