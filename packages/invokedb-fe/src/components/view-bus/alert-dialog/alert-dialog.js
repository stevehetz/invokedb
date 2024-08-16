export default {
    name: 'AlertDialog',
    data: () => {
        return {
            title: '',
            message: '',
            dialog_visible: false,
            close_callback: null
        };
    },
    methods: {
        open_dialog(data) {
            this.title = data.title;
            this.message = data.message;
            this.dialog_visible = true;
            if (data.callback) this.close_callback = data.callback;
        },

        close_handler() {
            if (this.close_callback) this.close_callback();
            this.dialog_visible = false;
        }
    }
};
