import Vue from 'vue';
import copy from 'copy-to-clipboard';
import { store } from '@/store';

export default Vue.extend({
    props: ['props'],

    data() {
        return {
            table_name: null,
            get_url: null,
            search_url: null,
            create_url: null,
            update_url: null,
            delete_url: null,
            show_copied_popup: {}
        };
    },

    mounted() {
        const file = this.props.file;
        this.table_name = file.name.replace(/.g/g, '');
        const table_name_lower = this.table_name.toLowerCase();
        const env = store.get('env');
        const base_url = env.HORIZON_API_PUB_HTTP_URL + '/v1';

        this.get_url = `${base_url}/get?table=${table_name_lower}&skip=0&limit=10`;
        this.search_url = `${base_url}/search?table=${table_name_lower}&skip=0&limit=10`;
        this.create_url = `${base_url}/create?table=${table_name_lower}`;
        this.update_url = `${base_url}/update?table=${table_name_lower}`;
        this.delete_url = `${base_url}/delete?table=${table_name_lower}`;
    },

    methods: {
        copy_to_clipboard(section, text) {
            copy(text);
            this.show_copied_popup = Object.assign({
                [section]: true
            });
            window.setTimeout(
                () =>
                    (this.show_copied_popup = Object.assign({
                        [section]: false
                    })),
                1500
            );
        },

        go_to_doc_link(hash) {
            this.$bus.$emit('container-dialog:close');
            this.$router.push(`/app/api#${hash}`);
        }
    }
});
