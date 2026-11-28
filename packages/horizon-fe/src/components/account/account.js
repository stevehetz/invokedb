// @ts-nocheck: not type-checked yet
import SubscriptionForm from './subscription-form';
import ApiKeyForm from './api-key-form';
import AccountInfoForm from './account-info-form';
import ChangePasswordForm from './change-password-form';
import TwoFactorForm from './two-factor-form';
import DataExportForm from './data-export-form';
import DeleteAccountForm from './delete-account-form';
import AuditLog from '../audit-log';
import DemoOff from '../demo-off';
import { store } from '@/store';
import { is_demo_account } from '@/core/demo';

/** The page's sections, in the nav's order; the first is the default (#342, #350) */
const SECTIONS = [
    { id: 'profile', label: 'Profile', icon: 'fa-user' },
    { id: 'usage', label: 'Plan & usage', icon: 'fa-gauge' },
    { id: 'api-keys', label: 'API keys', icon: 'fa-key' },
    { id: 'security', label: 'Security', icon: 'fa-lock' },
    { id: 'history', label: 'History', icon: 'fa-clock-rotate-left' },
    { id: 'data', label: 'Data', icon: 'fa-database' }
];

/**
 * The section `?section=` names; the first (Profile) without one or for an unknown one, and
 * Plan & usage while `?upgrade=` or `?billing=` (the pricing page, Stripe's return) is handled
 * there.
 * @param {Record<string, any>} query the route's query
 */
function account_section(query) {
    const q = query || {};
    if (q.upgrade || q.billing) return 'usage';
    const id = String(q.section || '');
    return SECTIONS.some(s => s.id === id) ? id : SECTIONS[0].id;
}

export default {
    name: 'Account',

    components: {
        SubscriptionForm,
        ApiKeyForm,
        AuditLog,
        AccountInfoForm,
        ChangePasswordForm,
        TwoFactorForm,
        DataExportForm,
        DeleteAccountForm,
        DemoOff
    },

    data: () => {
        return {
            sections: SECTIONS,
            account: null,
            account_subscription: null
        };
    },

    computed: {
        section() {
            return account_section(this.$route.query);
        },

        // A no-signup demo account (#333)
        demo() {
            return is_demo_account(this.account);
        }
    },

    mounted() {
        this.account_subscription = store.subscribe('account', account => {
            this.account = account;
        });
    },

    watch: {
        // A new section starts at the top of the page
        section() {
            const body = this.$el && this.$el.querySelector('.page-body');
            if (body) body.scrollTop = 0;
        }
    },

    beforeUnmount() {
        this.account_subscription.unsubscribe();
    }
};
