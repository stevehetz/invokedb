import screenshot_row_edit from '@/assets/screenshot-row-edit.png';
import screenshot_column_edit from '@/assets/screenshot-column-edit.png';
import screenshot_filter from '@/assets/screenshot-filter.png';
import { highlight_code_blocks } from '@/core/utils/highlight';
import { store } from '@/store';

import * as samples from './code-samples';

export default {
    name: 'Home',

    data() {
        return {
            screenshots: [
                screenshot_row_edit,
                screenshot_column_edit,
                screenshot_filter
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
            highlight_code_blocks();
        },

        change_code_sample(type) {
            this.active_code = type;
            window.setTimeout(() => this.highlight(), 0);
        }
    }
};
