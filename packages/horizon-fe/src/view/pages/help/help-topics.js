// The help pages' topics (#219), in the order the sidebar lists them. Each id is a URL
// (/help/<id>) and a section of help.html; add both together.

/** @typedef {{ id: string, title: string, icon: string }} HelpTopic */

/** @type {HelpTopic[]} */
export const HELP_TOPICS = [
    { id: 'getting-started', title: 'Getting started', icon: 'fa fa-flag' },
    { id: 'tables', title: 'Tables and columns', icon: 'fa fa-table' },
    { id: 'import', title: 'Importing data', icon: 'fa fa-upload' },
    { id: 'links', title: 'Link columns', icon: 'fa fa-link' },
    { id: 'api', title: 'The API', icon: 'fa fa-code' },
    { id: 'api-keys', title: 'API keys', icon: 'fa fa-key' },
    { id: 'webhooks', title: 'Webhooks', icon: 'fa fa-bolt' },
    { id: 'forms', title: 'Forms', icon: 'fa fa-list-alt' },
    { id: 'views', title: 'Views', icon: 'fa fa-eye' },
    { id: 'ai', title: 'Ask AI', icon: 'fa fa-wand-magic-sparkles' },
    { id: 'account', title: 'Your account', icon: 'fa fa-user' },
    { id: 'limits', title: 'Limits', icon: 'fa fa-gauge' }
];

/**
 * The topic for a URL's :topic, or the first one when it's missing or unknown.
 * @param {unknown} id
 * @returns {HelpTopic}
 */
export function find_topic(id) {
    return HELP_TOPICS.find(t => t.id === id) || HELP_TOPICS[0];
}

/**
 * The topic before (step -1) or after (step 1) a URL's :topic, or null at either end.
 * @param {unknown} id
 * @param {number} step
 * @returns {HelpTopic | null}
 */
export function neighbour_topic(id, step) {
    const i = HELP_TOPICS.indexOf(find_topic(id)) + step;
    return i >= 0 && i < HELP_TOPICS.length ? HELP_TOPICS[i] : null;
}
