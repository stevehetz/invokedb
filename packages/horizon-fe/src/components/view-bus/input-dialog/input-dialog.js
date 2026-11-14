export default {
    name: 'InputDialog',
    data: () => {
        return {
            title: '',
            message: '',
            placeholder: '',
            input_text: '',
            dialog_visible: false,
            confirm_callback: null,
            processing: false
        };
    },
    methods: {
        set_processing(value) {
            this.processing = value;
        },

        open_dialog(data) {
            this.processing = false;
            this.dialog_visible = true;
            this.input_text = data.input_text || '';
            this.title = data.title;
            this.message = data.message;
            this.placeholder = data.placeholder;
            if (data.callback) this.confirm_callback = data.callback;
        },

        async on_open() {
            await this.$nextTick();
            this.$refs.text_input.focus();
        },

        close_dialog() {
            this.dialog_visible = false;
        },

        cancel_handler() {
            this.dialog_visible = false;
        },

        confirm_handler() {
            if (this.confirm_callback) {
                this.confirm_callback(this.input_text);
            } else {
                this.input_text = '';
                this.dialog_visible = false;
            }
        }
    }
};
