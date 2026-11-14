import Vue from 'vue';

export default Vue.extend({
    data: function () {
        return {
            show_toast: false,
            type: 'info',
            message: null,
            timeout: null,
            lock: false,
            backdrop: false
        };
    },

    mounted() {},

    methods: {
        info(msg, duration, opts) {
            opts = opts || {};
            if (this.lock) return;
            this.type = 'info';
            this.show(msg, duration, opts);
        },

        error(msg, duration, opts) {
            if (this.lock) return;
            this.type = 'error';
            this.show(msg, duration, opts);
        },

        success(msg, duration, opts) {
            if (this.lock) return;
            this.type = 'success';
            this.show(msg, duration, opts);
        },

        show(msg, duration, opts) {
            opts = opts || {};
            if (this.lock) return;
            this.lock = opts.lock;
            this.backdrop = opts.backdrop;
            window.clearTimeout(this.timeout);
            this.show_toast = true;
            this.message = msg;
            if (duration) {
                this.timeout = window.setTimeout(() => {
                    this.show_toast = false;
                    this.message = null;
                    this.lock = false;
                }, duration);
            }
        },

        hide() {
            if (this.lock) return;
            window.clearTimeout(this.timeout);
            this.show_toast = false;
            this.message = null;
            this.type = 'info';
        }
    }
});
