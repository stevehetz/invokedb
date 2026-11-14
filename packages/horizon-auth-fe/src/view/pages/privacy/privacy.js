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
    },

    methods: {
        go_to_database(e) {
            e.preventDefault();
            window.location.href = store.get('env').HORIZON_FE_PUB_HTTP_URL;
        }
    }
};
