// The table's own API docs (#139): its endpoints with examples and snippets built from its
// columns by the backend (GET /web-file/:id/api-docs), and "Try it", which sends a real request
// to the public API with one of the account's keys (#138: made in this visit, or pasted).
// Requests that change data are off by default.
import { defineComponent } from 'vue';
import copy from 'copy-to-clipboard';
import { store } from '@/store';
import { bus } from '@/core/bus';
import { web_file_http } from '@/core/context/web-file/web-file-http';

const LANGUAGES = [
    { id: 'curl', label: 'curl' },
    { id: 'fetch', label: 'JavaScript (fetch)' },
    { id: 'client', label: 'JavaScript (invokedb)' },
    { id: 'python', label: 'Python' }
];

const METHOD_CLASS = { GET: 'get', POST: 'post', PUT: 'put' };

function pretty(value) {
    return JSON.stringify(value, null, 2);
}

export default defineComponent({
    props: ['props'],

    data() {
        return {
            docs: null,
            loading: true,
            load_error: null,
            active: 'get',
            lang: 'curl',
            languages: LANGUAGES,
            copied: null,
            copied_timer: null,
            try_key: (store.get('new_api_key') || {}).secret || '',
            allow_writes: false,
            try_url: '',
            try_body: '',
            try_response: null,
            running: false
        };
    },

    computed: {
        endpoint() {
            if (!this.docs) return null;
            return this.docs.endpoints.find(e => e.id === this.active);
        },

        method_class() {
            if (!this.endpoint) return '';
            // Delete is a POST, but shown in the delete colour as before
            if (this.endpoint.id === 'delete') return 'delete';
            return METHOD_CLASS[this.endpoint.method];
        },

        snippet() {
            return this.endpoint ? this.endpoint.snippets[this.lang] : '';
        },

        // Keys are only shown when they're made (#138): a key made in this visit, or one pasted
        api_key() {
            return this.try_key.trim();
        },

        export_line() {
            if (!this.docs) return '';
            return `export ${this.docs.api_key_env}=${this.api_key || 'YOUR_API_KEY'}`;
        },

        export_line_masked() {
            if (!this.docs) return '';
            return `export ${this.docs.api_key_env}=${'•'.repeat(12)}`;
        },

        can_try() {
            if (!this.endpoint || !this.api_key || this.running) return false;
            return this.endpoint.read_only || this.allow_writes;
        }
    },

    async mounted() {
        try {
            this.docs = await web_file_http.get_api_docs(this.props.file.id);
            this.reset_try();
        } catch (ex) {
            this.load_error =
                (ex && ex.message) || 'Could not load the API docs';
        }
        this.loading = false;
    },

    beforeUnmount() {
        window.clearTimeout(this.copied_timer);
    },

    methods: {
        pretty,

        select_endpoint(id) {
            this.active = id;
            this.reset_try();
        },

        reset_try() {
            const e = this.endpoint;
            this.try_url = e ? e.url : '';
            this.try_body = e && e.body !== undefined ? pretty(e.body) : '';
            this.try_response = null;
        },

        copy_to_clipboard(what, text) {
            copy(text);
            this.copied = what;
            window.clearTimeout(this.copied_timer);
            this.copied_timer = window.setTimeout(
                () => (this.copied = null),
                1500
            );
        },

        async try_it() {
            const e = this.endpoint;
            if (!this.can_try) return;

            /** @type {RequestInit} */
            const options = {
                method: e.method,
                headers: { Authorization: `Bearer ${this.api_key}` }
            };
            if (e.body !== undefined) {
                try {
                    JSON.parse(this.try_body);
                } catch (ex) {
                    this.try_response = {
                        ok: false,
                        status: 'Not sent',
                        ms: 0,
                        body: `The body isn't valid JSON: ${ex.message}`
                    };
                    return;
                }
                options.headers['Content-Type'] = 'application/json';
                options.body = this.try_body;
            }

            this.running = true;
            const start = Date.now();
            try {
                const res = await fetch(this.try_url, options);
                const text = await res.text();
                let body = text || '(no body)';
                try {
                    body = pretty(JSON.parse(text));
                } catch (ex) {
                    // not JSON: show the text
                }
                this.try_response = {
                    ok: res.ok,
                    status: res.status,
                    ms: Date.now() - start,
                    body
                };
            } catch (ex) {
                this.try_response = {
                    ok: false,
                    status: 'Failed',
                    ms: Date.now() - start,
                    body: `The request failed: ${ex.message}`
                };
            }
            this.running = false;
        },

        async download_openapi() {
            const spec = await web_file_http.get_openapi(this.props.file.id);
            const blob = new Blob([JSON.stringify(spec, null, 2)], {
                type: 'application/json'
            });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${this.docs.table}.openapi.json`;
            a.click();
            URL.revokeObjectURL(url);
        },

        go_to_account() {
            bus.$emit('container-dialog:close');
            this.$router.push({
                name: 'account',
                query: { section: 'api-keys' }
            });
        },

        go_to_doc_link(hash) {
            bus.$emit('container-dialog:close');
            this.$router.push(`/app/api#${hash}`);
        }
    }
});
