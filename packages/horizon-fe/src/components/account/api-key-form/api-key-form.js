// The account's API keys (#138): each named, read-only or read-write, for every table or some,
// and revocable. A new key is shown once, here; after that only its first characters.
import { defineComponent } from 'vue';
import copy from 'copy-to-clipboard';
import { bus } from '@/core/bus';
import { api_key_http } from '@/core/context/api-key/api-key-http';

const ACCESS_LABELS = {
    read: 'Read only',
    read_write: 'Read and write'
};

function error_message(ex, fallback) {
    if (ex && typeof ex.message === 'string') return ex.message;
    if (ex && Array.isArray(ex.message)) return ex.message.join(', ');
    return fallback;
}

export default defineComponent({
    name: 'ApiKeyForm',

    data() {
        return {
            loading: true,
            load_error: null,
            keys: [],
            tables: [],
            max: 0,
            show_new: false,
            saving: false,
            form: { name: '', access: 'read', all_tables: true, table_ids: [] },
            // The key just made: { key, secret }, shown until the page is left or it's dismissed
            created: null,
            show_copied_popup: false,
            copied_timer: null
        };
    },

    computed: {
        live_count() {
            return this.keys.filter(k => !k.revoked_datetime).length;
        },

        at_max() {
            return this.max > 0 && this.live_count >= this.max;
        },

        can_save() {
            if (this.saving || !this.form.name.trim()) return false;
            return this.form.all_tables || this.form.table_ids.length > 0;
        }
    },

    mounted() {
        this.load();
    },

    beforeUnmount() {
        window.clearTimeout(this.copied_timer);
    },

    methods: {
        access_label(access) {
            return ACCESS_LABELS[access] || access;
        },

        tables_label(key) {
            if (!key.table_ids) return 'All tables';
            if (!key.tables || key.tables.length === 0) return 'No tables left';
            return key.tables.map(t => t.name).join(', ');
        },

        time(value) {
            return value ? new Date(value).toLocaleString() : '';
        },

        async load() {
            try {
                const res = await api_key_http.list();
                this.keys = res.keys || [];
                this.tables = res.tables || [];
                this.max = res.max || 0;
                this.load_error = null;
            } catch (ex) {
                this.load_error = error_message(ex, "Couldn't load your keys");
            }
            this.loading = false;
        },

        open_new() {
            this.form = {
                name: '',
                access: 'read',
                all_tables: true,
                table_ids: []
            };
            this.show_new = true;
        },

        async save() {
            if (!this.can_save) return;
            this.saving = true;
            try {
                this.created = await api_key_http.create({
                    name: this.form.name.trim(),
                    access: this.form.access,
                    table_ids: this.form.all_tables ? null : this.form.table_ids
                });
                this.show_new = false;
                await this.load();
            } catch (ex) {
                bus.$emit(
                    'notify:error',
                    error_message(ex, "Couldn't make the key")
                );
            }
            this.saving = false;
        },

        copy_secret() {
            if (!this.created) return;
            copy(this.created.secret);
            this.show_copied_popup = true;
            window.clearTimeout(this.copied_timer);
            this.copied_timer = window.setTimeout(
                () => (this.show_copied_popup = false),
                1500
            );
        },

        revoke(key) {
            bus.$emit('confirm-dialog:open', {
                title: 'Revoke the key',
                message: `Revoke <b>${escape_html(key.name)}</b>? Anything using it stops working at once. This can't be undone.`,
                callback: async () => {
                    try {
                        await api_key_http.revoke(key.id);
                        if (this.created && this.created.key.id === key.id) {
                            this.created = null;
                        }
                        await this.load();
                    } catch (ex) {
                        bus.$emit(
                            'notify:error',
                            error_message(ex, "Couldn't revoke the key")
                        );
                    }
                }
            });
        }
    }
});

function escape_html(s) {
    return String(s).replace(
        /[&<>"']/g,
        c =>
            ({
                '&': '&amp;',
                '<': '&lt;',
                '>': '&gt;',
                '"': '&quot;',
                "'": '&#39;'
            })[c]
    );
}
