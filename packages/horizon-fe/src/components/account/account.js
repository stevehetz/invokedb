// @ts-nocheck: not type-checked yet
import SubscriptionForm from './subscription-form';
import ApiKeyForm from './api-key-form';
import AccountInfoForm from './account-info-form';
import ChangePasswordForm from './change-password-form';
import DeleteAccountForm from './delete-account-form';
import { store } from '@/store';
import { onboarding_http } from '@/core/context/onboarding/onboarding-http';

export default {
    name: 'Account',

    components: {
        SubscriptionForm,
        ApiKeyForm,
        AccountInfoForm,
        ChangePasswordForm,
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
        // This page shows the API key: tick the onboarding checklist's step (#143)
        onboarding_http.mark('view_api_key').catch(() => {});
    },

    beforeUnmount() {
        this.account_subscription.unsubscribe();
    }
};
