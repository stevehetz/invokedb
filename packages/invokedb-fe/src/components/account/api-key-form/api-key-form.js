import copy from 'copy-to-clipboard';

export default {
    name: 'ApiKeyForm',

    props: ['account'],

    data() {
        return {
            show_copied_popup: false
        };
    },

    methods: {
        copy_to_clipboard() {
            this.show_copied_popup = true;
            copy(this.account.api_key);
            window.setTimeout(() => (this.show_copied_popup = false), 1500);
        }
    }
};
