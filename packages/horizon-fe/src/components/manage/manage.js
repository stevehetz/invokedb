export default {
    name: 'Manage',

    components: {},

    data: function() {
        return {
            start_page: 'api',
            active_page: null
        };
    },

    mounted() {
        this.redirect();
        this.set_active();
    },

    methods: {
        redirect() {
            let { name } = this.$router.history.current;
            if (name === 'manage') {
                this.$router.push(`/manage/${this.start_page}`);
            }
        },

        set_active() {
            let { name } = this.$router.history.current;
            this.active_page = name;
        },

        handle_select(page) {
            this.$router.push(`/manage/${page}`);
        }
    }
};
