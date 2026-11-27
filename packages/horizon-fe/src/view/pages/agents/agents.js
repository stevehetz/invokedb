import { defineComponent } from 'vue';
import copy from 'copy-to-clipboard';
import { store } from '@/store';
import { KEY_PLACEHOLDER, agent_snippet, mcp_url } from '@/core/agent-setup';

// The clients the page shows a setup for. Claude Code takes a command; Cursor and VS Code take
// the JSON config, the same two setups as the Account page's "Use with AI agents" box.
/** @type {{ value: string, label: string, setup: string }[]} */
const CLIENTS = [
    { value: 'claude_code', label: 'Claude Code', setup: 'claude_code' },
    { value: 'cursor', label: 'Cursor', setup: 'json' },
    { value: 'vscode', label: 'VS Code', setup: 'json' }
];

// A first thing to ask, once the agent is connected
const FIRST_PROMPT =
    'List my InvokeDB tables. For the first one, describe its columns, show me its ' +
    '5 most recent rows and tell me anything that looks wrong in them.';

// The agent quickstart (#331): from nothing to an agent using your tables, in a few steps
export default defineComponent({
    name: 'Agents',

    data() {
        return {
            /** @type {any} */
            account: null,
            /** @type {any} */
            account_sub: null,
            /** @type {any} */
            env_sub: null,
            clients: CLIENTS,
            client: CLIENTS[0].value,
            first_prompt: FIRST_PROMPT,
            backend_url: (store.get('env') || {}).HORIZON_BE_PUB_HTTP_URL || '',
            /** @type {string | null} what was just copied: 'snippet' or 'prompt' */
            copied: null,
            /** @type {number | undefined} */
            copied_timer: undefined
        };
    },

    computed: {
        /** @returns {string} */
        mcp_url() {
            return mcp_url(this.backend_url);
        },

        /** @returns {string} */
        snippet() {
            const client =
                CLIENTS.find(c => c.value === this.client) || CLIENTS[0];
            return agent_snippet(client.setup, this.mcp_url, KEY_PLACEHOLDER);
        }
    },

    created() {
        this.account_sub = store.subscribe('account', account => {
            this.account = account;
        });
        this.env_sub = store.subscribe('env', env => {
            this.backend_url = (env && env.HORIZON_BE_PUB_HTTP_URL) || '';
        });
    },

    beforeUnmount() {
        for (const sub of [this.account_sub, this.env_sub]) {
            if (sub && typeof sub.unsubscribe === 'function') sub.unsubscribe();
        }
        window.clearTimeout(this.copied_timer);
    },

    methods: {
        /** @param {'snippet' | 'prompt'} what */
        copy_text(what) {
            copy(what === 'prompt' ? this.first_prompt : this.snippet);
            this.copied = what;
            window.clearTimeout(this.copied_timer);
            this.copied_timer = window.setTimeout(
                () => (this.copied = null),
                1500
            );
        }
    }
});
