import { account_manager } from '@/core/context/account/account-manager';
import { form_mixin } from '@/components/_mixins/form.mixin';

export default {
    name: 'AccountInfoForm',

    props: ['account'],

    mixins: [form_mixin],

    watch: {
        // immediate: the Account page creates this form when its section opens (#342), usually
        // after the account has loaded, so a plain watcher would never fill the fields
        account: {
            handler(data) {
                if (data) this.$_form_set(data);
            },
            immediate: true
        }
    },

    methods: {
        on_save: async function (data) {
            await account_manager.update_account(data);
            this.$bus.$emit('notify:success', 'Saved succesfully');
        }
    }
};
