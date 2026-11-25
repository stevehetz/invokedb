/**
 * A table's name as the user sees it: its file name without the `.g` extension the tree gives
 * grid files (`crm_contacts.g` → `crm_contacts`).
 * @param {string} name
 * @returns {string}
 */
export function table_display_name(name) {
    return (name || '').replace(/\.g$/, '');
}
