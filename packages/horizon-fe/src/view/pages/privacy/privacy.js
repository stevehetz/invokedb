import { store } from '@/store';

export default {
    name: 'Tos',

    data() {
        return { account: null };
    },

    mounted() {
        store.subscribe('account', account => {
            this.account = account;
        });
    }
};
