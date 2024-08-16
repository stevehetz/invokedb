export default {
    name: 'ConfirmDialog',
    data: () => {
        return {
            title: '',
            message: '',
            dialog_visible: false,
            confirm_callback: null
        };
    },
    methods: {
        open_dialog(data) {
            this.title = data.title;
            this.message = data.message;
            this.dialog_visible = true;
            if (data.callback) this.confirm_callback = data.callback;
        },

        close_dialog() {
            this.dialog_visible = false;
        },

        cancel_handler() {
            this.dialog_visible = false;
        },

        confirm_handler() {
            if (this.confirm_callback) this.confirm_callback();
            this.dialog_visible = false;
        }
    }
};
