import { error_manager } from '@/core/error/error-manager';

export default {
    name: 'UploadDialog',
    data: () => {
        return {
            title: '',
            running: false,
            options: [],
            file_list: [],
            selected_option: null,
            new_name: '',
            file: null,
            file_ctx: null,
            progress: 0,
            status: null,
            http_handler: null,
            on_success: null,
            on_error: null,
            dialog_visible: false,
            error_message: null
        };
    },

    mounted() {
        $('.dialog-upload').bind('click.upload_dialog', e => {
            if (e.target.className === 'el-upload__input') {
                this.new_name = '';
                this.progress = 0;
                this.status = null;
                this.$refs.upload.clearFiles();
            }
        });
    },

    unmounted() {
        $('body').unbind('.upload_dialog');
    },

    methods: {
        open_dialog(data) {
            this.running = false;
            this.file_ctx = null;
            this.dialog_visible = true;
            this.title = data.title;
            this.options = data.options || [];
            this.new_name = '';
            this.error_message = null;
            this.selected_option =
                this.options.length > 0 ? this.options[0].id : null;
            this.progress = 0;
            this.status = null;
            this.on_success = data.on_success || null;
            this.on_error = data.on_error || null;
            this.http_handler = data.http_handler || null;
            if (this.$refs.upload) this.$refs.upload.clearFiles();
        },

        on_open() {},

        close_dialog(data) {
            this.dialog_visible = false;
        },

        cancel_handler() {
            if (this.file_ctx && this.file_ctx.abort) {
                this.file_ctx.abort();
            }
            this.dialog_visible = false;
        },

        upload_handler() {
            this.running = true;
            this.progress = 0;
            this.status = null;
            this.error_message = null;
            this.$refs.upload.submit();
        },

        http_request(file_ctx) {
            this.file_ctx = file_ctx;

            if (!this.http_handler) {
                return console.log('Please provide an http request handler');
            }

            file_ctx.onProgress = e => {
                this.progress = e.percent;
            };

            file_ctx.onError = e => {
                this.running = false;
                let error_message = 'Error uploading file, please try again.';
                if (e) {
                    if (e.status === 400 && e.message === 'Validation error') {
                        error_message =
                            error_manager.first_rule_msg('name', e.rules) ||
                            'Validation error';
                        this.status = 'exception';
                    } else {
                        try {
                            const parsed = JSON.parse(e.message);
                            error_message = parsed.message || e.message;
                        } catch (ex) {}
                    }
                }
                this.error_message = error_message;
                this.status = 'exception';
                if (this.on_error) this.on_error(e);
            };

            file_ctx.onSuccess = e => {
                this.dialog_visible = false;
                if (this.on_success) this.on_success(e);
            };

            let option = this.options.find(o => o.id === this.selected_option);

            this.http_handler(
                file_ctx,
                this.new_name,
                option,
                callback_options => {
                    if (callback_options) {
                        console.log(callback_options);
                    }
                }
            ).then(
                () => {},
                err => {
                    this.running = false;
                    this.status = 'exception';
                    this.error_message =
                        err && err.message
                            ? err.message
                            : 'Error uploading file, please try again.';
                    if (
                        err &&
                        err.status === 400 &&
                        err.message === 'Validation error'
                    ) {
                        this.error_message =
                            error_manager.first_rule_msg('name', err.rules) ||
                            'Validation error';
                    }
                }
            );
        },

        on_change(e) {
            if (this.new_name === '' && e.name) {
                this.new_name = e.name.substring(0, e.name.lastIndexOf('.'));
                this.new_name = this.new_name.replace(/\s/g, '');
            }
        },

        on_remove(e) {},

        trigger_clicked(e) {
            this.running = false;
            this.file_ctx = null;
            this.progress = 0;
            this.error_message = null;
            this.status = null;
            this.new_name = '';
            this.$refs.upload.clearFiles();
        }
    }
};
