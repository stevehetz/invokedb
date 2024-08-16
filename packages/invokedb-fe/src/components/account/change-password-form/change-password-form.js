import { form_mixin } from '@/components/_mixins/form.mixin';
import { account_manager } from '@/core/context/account/account-manager';

export default {
	name: 'ChangePasswordForm',

	mixins: [form_mixin],

	methods: {
		async on_save(data) {
			await account_manager.change_password(data);
			this.$_form_clear();
			bus.emit('notify:success', 'Saved succesfully');
		},
	},
};
