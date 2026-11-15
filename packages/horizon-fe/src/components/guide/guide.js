import { scroll_spy } from '@/components/_page/scroll-spy';
import { store } from '@/store';

export default {
    name: 'Guide',

    data() {
        return {
            base_url: null,
            account: null,
            env: {}
        };
    },

    mounted() {
        window.addEventListener('popstate', this.go_to_hash);
        this.account = store.get('account');
        this.env = store.get('env');
        this.$nextTick(() => {
            this.go_to_hash();

            this.stop_scroll_spy = scroll_spy({
                container: '.guide-page',
                links: '.guide-nav > a',
                sections: '.guide-section-title',
                offset: 150
            });
        });
        store.subscribe('env', env => {
            this.base_url = `${env.HORIZON_BE_PUB_HTTP_URL}/api`;
        });
    },

    beforeUnmount() {
        if (this.stop_scroll_spy) this.stop_scroll_spy();
        window.removeEventListener('popstate', this.go_to_hash);
    },

    methods: {
        go_to_hash() {
            const { hash } = window.location;
            if (hash && hash.length > 1) {
                const element = document.querySelector(hash);
                if (element) {
                    element.scrollIntoView();
                }
            }
        }
    }
};
