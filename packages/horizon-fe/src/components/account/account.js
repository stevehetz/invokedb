// @ts-nocheck: not type-checked yet
import SubscriptionForm from './subscription-form';
import ApiKeyForm from './api-key-form';
import AccountInfoForm from './account-info-form';
import ChangePasswordForm from './change-password-form';
import TwoFactorForm from './two-factor-form';
import DataExportForm from './data-export-form';
import DeleteAccountForm from './delete-account-form';
import AuditLog from '../audit-log';
import { store } from '@/store';

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
        DeleteAccountForm
    },

    data: () => {
        return {
            account: null,
            account_subscription: null
        };
    },

    mounted() {
        this.account_subscription = store.subscribe('account', account => {
            this.account = account;
        });
        // Making a key here ticks the onboarding checklist's key step (#138, #143)
    },

    beforeUnmount() {
        this.account_subscription.unsubscribe();
    }
};
