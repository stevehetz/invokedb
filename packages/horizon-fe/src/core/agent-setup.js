// How an MCP client connects to InvokeDB's MCP server (#305): the Account page's "Use with AI
// agents" box and the site's /agents page (#331) both show these, so they can't disagree.

/** @typedef {{ value: string, label: string }} AgentSetup */

/** @type {AgentSetup[]} */
export const AGENT_SETUPS = [
    { value: 'claude_code', label: 'Claude Code' },
    { value: 'json', label: 'JSON config' }
];

// What a snippet shows until a real key is filled in
export const KEY_PLACEHOLDER = 'YOUR_API_KEY';

/**
 * The MCP server's address: the backend's public URL (api.invokedb.com in production) + /mcp.
 * @param {string} backend_url
 */
export function mcp_url(backend_url) {
    return `${(backend_url || '').replace(/\/+$/, '')}/mcp`;
}

/**
 * How to connect an MCP client to an account's tables with `key`.
 * @param {string} setup @param {string} url @param {string} key
 */
export function agent_snippet(setup, url, key) {
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
