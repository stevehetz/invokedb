import { account_manager } from '@/core/context/account/account-manager';
import { store } from '@/store';

export default {
	name: 'DeleteAccountForm',

	props: ['account'],

	methods: {
		async on_click() {
			bus.emit('confirm-dialog:open', {
				title: 'Delete Account',
				message: 'Are you sure?',
				callback: async () => {
					await account_manager.delete_account(this.account.id);
					await account_manager.logout();
					const env = store.get('env');
					window.location.href = env.HORIZON_AUTH_FE_PUB_HTTP_URL;
				},
			});
		},
	},
};
