const hljs = window.hljs;
import javascript from 'highlight.js/lib/languages/javascript';
hljs.registerLanguage('javascript', javascript);
import { store } from '@/store';

import * as samples from './code-samples';

export default {
    name: 'Home',

    data() {
        return {
            screenshots: [
                'screenshot-row-edit.png',
                'screenshot-column-edit.png',
                'screenshot-filter.png'
            ],
            code: {
                search: samples.search,
                create: samples.create,
                update: samples.update,
                remove: samples.remove
            },
            active_code: 'create',
            account: null
        };
    },

    mounted() {
        this.highlight();
        store.subscribe('account', account => {
            this.account = account;
        });
    },

    methods: {
        go_to_database(e) {
            e.preventDefault();
            window.location.href = '/app';
        },

        highlight() {
            document.querySelectorAll('pre code').forEach(block => {
                hljs.highlightBlock(block);
            });
        },

        change_code_sample(type) {
            this.active_code = type;
            window.setTimeout(() => this.highlight(), 0);
        }
    }
};
