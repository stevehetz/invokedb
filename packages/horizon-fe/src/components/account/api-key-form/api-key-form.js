// The account's API keys (#138): each named, read-only or read-write, for every table or some,
// and revocable. A new key is shown once, here; after that only its first characters. A key can
// have its own rate limit, and its last requests show under it (#216).
import { defineComponent } from 'vue';
import copy from 'copy-to-clipboard';
import { bus } from '@/core/bus';
import { store } from '@/store';
import { api_key_http } from '@/core/context/api-key/api-key-http';

// The setups the "Use with AI agents" box shows (#305), for the MCP server at <backend>/mcp
const AGENT_SETUPS = [
    { value: 'claude_code', label: 'Claude Code' },
    { value: 'json', label: 'JSON config' }
];

/**
 * How to connect an MCP client to this account's tables with `key`.
 * @param {string} setup @param {string} url @param {string} key
 */
function agent_snippet(setup, url, key) {
    if (setup === 'claude_code') {
        return `claude mcp add --transport http invokedb ${url} \\\n  --header "Authorization: Bearer ${key}"`;
    }
    // Cursor's mcp.json, VS Code, and a project's .mcp.json for Claude Code all read this shape
    const config = {
        mcpServers: {
            invokedb: {
                type: 'http',
                url,
                headers: { Authorization: `Bearer ${key}` }
            }
        }
    };
    return JSON.stringify(config, null, 2);
}

const ACCESS_LABELS = {
    read: 'Read only',
    read_write: 'Read and write'
};

// A key's own rate limit (#216), as the backend checks it (api-key-rules.ts)
const MIN_RATE = 0.1;
const MAX_RATE = 1000;
const MAX_BURST = 10000;

function new_form() {
    return {
        name: '',
        access: 'read',
        all_tables: true,
        table_ids: [],
        limited: false,
        per_second: 5,
        burst: undefined
    };
}

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
            // Days a revoked key is kept (and listed) before the backend deletes it (#178)
            revoked_kept_days: 0,
            // Revoked keys are hidden unless asked for, except those revoked on this visit
            show_revoked: false,
            revoked_here: [],
            show_new: false,
            saving: false,
            form: new_form(),
            // The key whose recent requests are shown under it (#216), and those requests
            open_requests: null,
            requests: [],
            requests_max: 0,
            requests_loading: false,
            requests_error: null,
            min_rate: MIN_RATE,
            max_rate: MAX_RATE,
            max_burst: MAX_BURST,
            // The key just made: { key, secret }, shown until the page is left or it's dismissed
            created: null,
            show_copied_popup: false,
            copied_timer: null,
            // The "Use with AI agents" box (#305)
            agent_setups: AGENT_SETUPS,
            agent_setup: AGENT_SETUPS[0].value,
            agent_copied: false,
            backend_url: (store.get('env') || {}).HORIZON_BE_PUB_HTTP_URL || ''
        };
    },

    created() {
        store.subscribe('env', env => {
            this.backend_url = (env && env.HORIZON_BE_PUB_HTTP_URL) || '';
        });
    },

    computed: {
        // The MCP server's address: the backend's public URL (api.invokedb.com in production)
        mcp_url() {
            return `${this.backend_url.replace(/\/+$/, '')}/mcp`;
        },

        // The key just made goes straight into the setup; otherwise a placeholder
        agent_snippet() {
            const key = this.created ? this.created.secret : 'YOUR_API_KEY';
            return agent_snippet(this.agent_setup, this.mcp_url, key);
        },

        agent_note() {
            return this.created
                ? 'Your new key is filled in above.'
                : 'Replace YOUR_API_KEY with a key; a new key is filled in for you.';
        },
        live_count() {
            return this.keys.filter(k => !k.revoked_datetime).length;
        },

        revoked_count() {
            return this.keys.length - this.live_count;
        },

        shown_keys() {
            if (this.show_revoked) return this.keys;
            return this.keys.filter(
                k => !k.revoked_datetime || this.revoked_here.includes(k.id)
            );
        },

        revoked_toggle_label() {
            return this.show_revoked
                ? 'Hide revoked keys'
                : `Show revoked keys (${this.revoked_count})`;
        },

        at_max() {
            return this.max > 0 && this.live_count >= this.max;
        },

        can_save() {
            if (this.saving || !this.form.name.trim()) return false;
            if (this.form.limited && !(this.form.per_second > 0)) return false;
            return this.form.all_tables || this.form.table_ids.length > 0;
        },

        // What the backend gives a key with no burst set: two seconds' worth
        default_burst() {
            const rate = Number(this.form.per_second) || 1;
            return Math.min(MAX_BURST, Math.max(1, Math.ceil(rate * 2)));
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

        limit_label(key) {
            const limit = key.rate_limit;
            if (!limit) return "Account's";
            return `${limit.per_second}/s, bursts of ${limit.burst}`;
        },

        async toggle_requests(key) {
            if (this.open_requests === key.id) {
                this.open_requests = null;
                return;
            }
            this.open_requests = key.id;
            this.requests = [];
            await this.load_requests(key);
        },

        async load_requests(key) {
            this.requests_loading = true;
            this.requests_error = null;
            try {
                const res = await api_key_http.requests(key.id);
                if (this.open_requests !== key.id) return;
                this.requests = (res && res.requests) || [];
                this.requests_max = (res && res.max) || 0;
            } catch (ex) {
                if (this.open_requests !== key.id) return;
                this.requests_error = error_message(
                    ex,
                    "Couldn't load the key's requests"
                );
            } finally {
                if (this.open_requests === key.id) {
                    this.requests_loading = false;
                }
            }
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
                this.revoked_kept_days = res.revoked_kept_days || 0;
                this.load_error = null;
            } catch (ex) {
                this.load_error = error_message(ex, "Couldn't load your keys");
            }
            this.loading = false;
        },

        open_new() {
            this.form = new_form();
            this.show_new = true;
        },

        async save() {
            if (!this.can_save) return;
            this.saving = true;
            try {
                this.created = await api_key_http.create({
                    name: this.form.name.trim(),
                    access: this.form.access,
                    table_ids: this.form.all_tables
                        ? null
                        : this.form.table_ids,
                    // The key's own limit (#216); a blank burst gets the default
                    rate_limit_per_second: this.form.limited
                        ? this.form.per_second
                        : null,
                    rate_limit_burst:
                        this.form.limited && this.form.burst
                            ? this.form.burst
                            : null
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

        copy_agent_snippet() {
            copy(this.agent_snippet);
            this.agent_copied = true;
            window.setTimeout(() => (this.agent_copied = false), 1500);
        },

        revoke(key) {
            bus.$emit('confirm-dialog:open', {
                title: 'Revoke the key',
                message: `Revoke <b>${escape_html(key.name)}</b>? Anything using it stops working at once. This can't be undone.`,
                callback: async () => {
                    try {
                        await api_key_http.revoke(key.id);
                        this.revoked_here.push(key.id);
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
