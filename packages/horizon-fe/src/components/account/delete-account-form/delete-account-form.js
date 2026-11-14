import { account_manager } from '@/core/context/account/account-manager';

export default {
    name: 'DeleteAccountForm',

    props: ['account'],

    methods: {
        async on_click() {
            this.$bus.$emit('confirm-dialog:open', {
                title: 'Delete Account',
                message: 'Are you sure?',
                callback: async () => {
                    await account_manager.delete_account(this.account.id);
                    await account_manager.logout();
                    window.location.href = '/';
                }
            });
        }
    }
};
