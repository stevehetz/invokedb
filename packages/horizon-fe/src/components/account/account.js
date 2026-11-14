import SubscriptionForm from './subscription-form';
import ApiKeyForm from './api-key-form';
import AccountInfoForm from './account-info-form';
import ChangePasswordForm from './change-password-form';
import DeleteAccountForm from './delete-account-form';
import { store } from '@/store';

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
    },

    beforeDestroy() {
        this.account_subscription.unsubscribe();
    }
};
