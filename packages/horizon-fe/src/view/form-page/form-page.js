// A shareable form's public page (#145): `/f/<id>`, or `/f/<id>?embed=1` inside another site's
// iframe (no page background). Anyone with the link can answer it; each submission becomes a
// row of the owner's table. It's outside both areas' shells, so it brings its own (scoped) CSS.
import { defineComponent } from 'vue';
import { public_form_http } from '@/core/context/form/form-http';

const LONG_TEXT = /message|comment|note|feedback|description|question|details/i;

export default defineComponent({
    data() {
        return {
            loading: true,
            /** @type {any} */
            form: null,
            /** @type {string | null} */
            unavailable: null,
            /** @type {Record<string, any>} */
            values: {},
            honeypot: '',
            /** @type {Record<string, string>} */
            errors: {},
            /** @type {string | null} */
            message: null,
            sending: false,
            done: false,
            thank_you: ''
        };
    },

    computed: {
        /** @returns {boolean} */
        embed() {
            return this.$route.query.embed === '1';
        }
    },

    async mounted() {
        await this.load();
    },

    methods: {
        async load() {
            const id = String(this.$route.params.id || '');
            try {
                this.form = await public_form_http.get(id);
                document.title = `${this.form.title} | InvokeDB`;
                this.reset();
            } catch (ex) {
                this.unavailable =
                    (ex && ex.status && ex.message) ||
                    'This form could not be loaded. Try again later.';
            }
            this.loading = false;
        },

        reset() {
            /** @type {Record<string, any>} */
            const values = {};
            this.form.fields.forEach(f => (values[f.key] = ''));
            this.values = values;
            this.honeypot = '';
            this.errors = {};
            this.message = null;
        },

        /** @param {any} f */
        input_type(f) {
            if (f.type === 'number') return 'number';
            if (f.type === 'date') return 'date';
            if (/e-?mail/i.test(f.label)) return 'email';
            return 'text';
        },

        /** @param {any} f */
        is_long(f) {
            return LONG_TEXT.test(f.label);
        },

        // The same checks as the server, so most mistakes show without a round trip
        check() {
            /** @type {Record<string, string>} */
            const errors = {};
            this.form.fields.forEach(f => {
                const value = this.values[f.key];
                const empty =
                    value === undefined ||
                    value === null ||
                    String(value).trim() === '';
                if (empty && f.required)
                    errors[f.key] = 'This field is required';
            });
            this.errors = errors;
            return Object.keys(errors).length === 0;
        },

        async submit() {
            if (this.sending) return;
            this.message = null;
            if (!this.check()) return;
            this.sending = true;
            try {
                /** @type {Record<string, any>} */
                const values = {};
                this.form.fields.forEach(f => {
                    const value = this.values[f.key];
                    values[f.key] =
                        value === undefined || value === null
                            ? ''
                            : String(value);
                });
                const res = await public_form_http.submit(this.form.id, {
                    values,
                    [this.form.honeypot]: this.honeypot
                });
                if (res && res.redirect_url) {
                    this.go(res.redirect_url);
                    return;
                }
                this.thank_you = (res && res.thank_you) || 'Thanks!';
                this.done = true;
            } catch (ex) {
                this.errors = (ex && ex.errors) || {};
                if (ex && (ex.status === 404 || ex.status === 410)) {
                    this.unavailable = ex.message;
                } else if (Object.keys(this.errors).length === 0) {
                    this.message =
                        (ex && ex.message) || 'Your response was not sent';
                } else {
                    this.message = 'Some answers need a look.';
                }
            }
            this.sending = false;
        },

        /** @param {string} url an http(s) URL the owner set (the server checked it) */
        go(url) {
            if (!/^https?:\/\//i.test(url)) return;
            if (this.embed) {
                // The whole page goes, not just the iframe
                try {
                    if (window.top) {
                        window.top.location.href = url;
                        return;
                    }
                } catch (ex) {
                    // A cross-origin parent may refuse; then the iframe goes
                }
            }
            window.location.href = url;
        },

        again() {
            this.reset();
            this.done = false;
        }
    }
});
