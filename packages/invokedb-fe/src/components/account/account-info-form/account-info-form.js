import { account_manager } from '@/core/context/account/account-manager';
import { form_mixin } from '@/components/_mixins/form.mixin';

export default {
	name: 'AccountInfoForm',

	props: ['account'],

	mixins: [form_mixin],

	watch: {
		account: function (data) {
			this.$_form_set(data);
		},
	},

	methods: {
		on_save: async function (data) {
			await account_manager.update_account(data);
			bus.emit('notify:success', 'Saved succesfully');
		},
	},
};
