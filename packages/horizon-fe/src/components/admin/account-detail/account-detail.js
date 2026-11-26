// One account in the admin area (#277): its numbers, tables (name, rows, size; never their
// rows), API keys (prefix only), history and AI use, and the actions. Each action is confirmed
// in a dialog (deleting needs the email typed again) and recorded in the account's history.
import { defineComponent } from 'vue';
import { admin_http } from '@/core/context/admin/admin-http';
import {
    ADMIN_PLANS,
    bytes_label,
    cap_label,
    count_label,
    date_label,
    time_label,
    usd_label
} from '@/core/context/admin/admin';
import { USAGE_ROWS, meter } from '@/core/context/plan/plan';

/** @param {any} ex @param {string} fallback */
function message_of(ex, fallback) {
    return (ex && ex.message) || fallback;
}

/**
 * @typedef {{ action: string, title: string, message: string, button: string,
 *   danger?: boolean, input?: 'reason' | 'email' | 'plan' }} Confirm
 */

export default defineComponent({
    name: 'AccountDetail',

    props: ['account_id'],

    emits: ['close'],

    data() {
        return {
            /** @type {any} */
            detail: null,
            error: '',
            /** @type {Confirm | null} */
            confirm: null,
            confirm_open: false,
            input: '',
            plan: 'FREE',
            busy: false,
            action_error: '',
            done: '',
            plans: ADMIN_PLANS
        };
    },

    computed: {
        meters() {
            const d = this.detail;
            if (!d) return [];
            return USAGE_ROWS.map(row => meter(row, d.usage[row.key]));
        },

        /** @returns {string} */
        sign_in_label() {
            const a = this.detail ? this.detail.account : null;
            if (!a) return '';
            const how = a.password_account ? 'Password' : 'Google or GitHub';
            return `${how}, two-factor ${a.two_factor ? 'on' : 'off'}`;
        },

        /** @returns {boolean} the dialog's button can be pressed */
        can_confirm() {
            const c = this.confirm;
            if (!c || this.busy) return false;
            if (c.input === 'email') {
                return (
                    this.input.trim().toLowerCase() ===
                    String(this.detail.account.email).toLowerCase()
                );
            }
            if (c.input === 'plan')
                return this.plan !== this.detail.account.plan;
            return true;
        }
    },

    watch: {
        account_id() {
            this.load();
        }
    },

    mounted() {
        this.load();
    },

    methods: {
        bytes_label,
        count_label,
        date_label,
        time_label,
        usd_label,
        cap_label,

        async load() {
            this.error = '';
            try {
                this.detail = await admin_http.account(this.account_id);
                this.plan = this.detail.account.plan;
            } catch (ex) {
                this.detail = null;
                this.error = message_of(ex, "The account couldn't be loaded.");
            }
        },

        /** @param {string} action */
        ask(action) {
            const email = this.detail.account.email;
            /** @type {Record<string, Confirm>} */
            const confirms = {
                plan: {
                    action: 'plan',
                    title: 'Change the plan',
                    message: `Put ${email} on another plan. Tables over the new plan's caps are locked; the change is in the account's history.`,
                    button: 'Change plan',
                    input: 'plan'
                },
                lock: {
                    action: 'lock',
                    title: 'Lock the account',
                    message: `${email} can still sign in and read, but can't change anything until it's unlocked. The reason is shown to them.`,
                    button: 'Lock',
                    danger: true,
                    input: 'reason'
                },
                unlock: {
                    action: 'unlock',
                    title: 'Unlock the account',
                    message: `${email} can change their data again.`,
                    button: 'Unlock'
                },
                'resend-verification': {
                    action: 'resend-verification',
                    title: 'Resend the verification email',
                    message: `Send a new verification link to ${email}.`,
                    button: 'Send'
                },
                'reset-two-factor': {
                    action: 'reset-two-factor',
                    title: 'Reset two-factor sign-in',
                    message: `Turn two-factor sign-in off for ${email}, so they can sign in with their password alone. Only after you've checked it's really them.`,
                    button: 'Reset two-factor',
                    danger: true
                },
                delete: {
                    action: 'delete',
                    title: 'Delete the account',
                    message: `Delete ${email} and end its sessions, as if they deleted it themselves. Type the email address to confirm.`,
                    button: 'Delete account',
                    danger: true,
                    input: 'email'
                }
            };
            this.confirm = confirms[action];
            this.input = '';
            this.plan = this.detail.account.plan;
            this.action_error = '';
            this.done = '';
            this.confirm_open = true;
        },

        async run() {
            const c = this.confirm;
            if (!c || !this.can_confirm) return;
            /** @type {any} */
            let body = {};
            if (c.input === 'reason') body = { reason: this.input };
            if (c.input === 'email') body = { confirm: this.input };
            if (c.input === 'plan') body = { plan: this.plan };
            this.busy = true;
            this.action_error = '';
            try {
                await admin_http.act(this.account_id, c.action, body);
                this.confirm_open = false;
                if (c.action === 'delete') {
                    this.$emit('close');
                    return;
                }
                this.done = `${c.title}: done.`;
                await this.load();
            } catch (ex) {
                this.action_error = message_of(ex, 'That didn’t work.');
            } finally {
                this.busy = false;
            }
        }
    }
});
