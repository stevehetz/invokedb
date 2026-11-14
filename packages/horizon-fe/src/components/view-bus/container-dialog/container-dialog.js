export default {
    name: 'ContainerDialog',
    data: () => {
        return {
            props: null,
            title: null,
            dialog_visible: false,
            child_component: null
        };
    },
    methods: {
        open_dialog(data) {
            this.props = data.props;
            this.title = data.title;
            this.child_component = data.component;
            this.dialog_visible = true;
        },

        close_dialog() {
            this.child_component = null;
            this.dialog_visible = false;
        },

        close_handler() {
            this.child_component = null;
            this.dialog_visible = false;
        }
    }
};
