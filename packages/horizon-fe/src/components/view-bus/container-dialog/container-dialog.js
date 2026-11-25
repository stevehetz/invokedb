import { markRaw } from 'vue';

export default {
    name: 'ContainerDialog',
    data: () => {
        return {
            props: null,
            title: null,
            // An extra class on the dialog: 'wide' for a bigger one (the schema diagram)
            dialog_class: null,
            dialog_visible: false,
            child_component: null
        };
    },
    methods: {
        open_dialog(data) {
            this.props = data.props;
            this.title = data.title;
            this.dialog_class = data.dialog_class || null;
            this.child_component = markRaw(data.component);
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
