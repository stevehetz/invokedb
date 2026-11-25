import { scroll_spy } from '@/components/_page/scroll-spy';
import { highlight_code_blocks } from '@/core/utils/highlight';
import * as samples from './code-samples';
import { store } from '@/store';

export default {
    name: 'Doc',

    data() {
        return {
            base_url: null,
            account: null,
            code: {
                get_paging: samples.get_paging,
                get_sorting: samples.get_sorting,
                search_text_contains: samples.search_text_contains,
                search_text_exact: samples.search_text_exact,
                search_number: samples.search_number,
                search_date: samples.search_date,
                search_one_column_and: samples.search_one_column_and,
                search_one_column_or: samples.search_one_column_or,
                search_two_columns_and: samples.search_two_columns_and,
                search_two_columns_or: samples.search_two_columns_or,
                search_group: samples.search_group,
                query: samples.query,
                count: samples.count,
                create: samples.create,
                update: samples.update,
                remove: samples.remove
            }
        };
    },

    mounted() {
        window.addEventListener('popstate', this.go_to_hash);
        this.account = store.get('account');
        this.$nextTick(() => {
            this.go_to_hash();

            this.stop_scroll_spy = scroll_spy({
                container: '.docs-page',
                links: '.docs-nav > a',
                sections: '.overview-title',
                offset: 180
            });
        });
        store.subscribe('env', env => {
            this.base_url = `${env.HORIZON_BE_PUB_HTTP_URL}/api`
                .replace(':443', '')
                .replace('be.', 'api.');
            this.base_url += '/v1';
        });
        this.highlight();
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
        },

        highlight() {
            highlight_code_blocks();
        }
    }
};
