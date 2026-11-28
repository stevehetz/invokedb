import { tree_consts } from './h-tree-consts';
import { store } from '@/store';
import { ai_http } from '@/core/context/ai/ai-http';

// Which folders are open, kept per browser (#357)
const OPEN_FOLDERS_KEY = 'invokedb:open-folders';

/** @returns {number[]} */
export function load_open_folders() {
    try {
        const ids = JSON.parse(
            window.localStorage.getItem(OPEN_FOLDERS_KEY) || '[]'
        );
        return Array.isArray(ids) ? ids.filter(Number.isInteger) : [];
    } catch {
        return [];
    }
}

/** @param {number[]} ids */
export function save_open_folders(ids) {
    try {
        window.localStorage.setItem(OPEN_FOLDERS_KEY, JSON.stringify(ids));
    } catch {
        // Private mode or storage full: folders just start closed next time
    }
}

// The table/folder tree (an Element Plus el-tree; it was jqtree). Click "manages" (highlights)
// an item for the delete/rename buttons; double-click "selects" it, which opens it in a tab.
// Right-click opens a menu for the item (#357): new tables in a folder, open, rename, move to a
// folder, delete. Folders are one level deep: new folders go at the top level, and a folder
// can't be dropped into another.
export default {
    name: 'HTree',

    props: ['tree_items'],

    emits: [
        'tree_item_selected',
        'add_tree_item',
        'remove_tree_items',
        'edit_tree_items',
        'move_tree_item',
        'move_to_folder',
        'open_schema'
    ],

    data: () => {
        return {
            account: null,
            account_subscription: null,

            // Ids of the items that are managed (highlighted)
            managed: [],

            // Id of the item open in the active tab
            selected_id: null,

            // Open folders, kept when the tree data is reloaded and in localStorage
            expanded_keys: load_open_folders(),

            // The right-click menu: where, and for which item
            /** @type {{ x: number, y: number, item: any } | null} */
            context_menu: null,

            tree_props: { label: 'name', children: 'children' },

            // The server has an AI model (#148): shows "Table from a description"
            ai_enabled: false
        };
    },

    mounted() {
        ai_http.enabled().then(enabled => (this.ai_enabled = enabled));
        this.account_subscription = store.subscribe('account', account => {
            this.account = account;
        });
        document.body.addEventListener('click', this.body_clicked);
        document.addEventListener('keydown', this.key_pressed);
        window.addEventListener('blur', this.close_context_menu);
    },

    beforeUnmount() {
        document.body.removeEventListener('click', this.body_clicked);
        document.removeEventListener('keydown', this.key_pressed);
        window.removeEventListener('blur', this.close_context_menu);
        if (this.account_subscription) this.account_subscription.unsubscribe();
    },

    methods: {
        /*** Start: Global events ***/
        body_clicked(e) {
            if (!e.target.closest('.file-directory-menu')) {
                this.$refs.menu.close('1');
            }
            this.close_context_menu();
        },

        /** @param {KeyboardEvent} e */
        key_pressed(e) {
            if (e.key === 'Escape') this.close_context_menu();
        },

        close_context_menu() {
            this.context_menu = null;
        },
        /*** End: Global events ***/

        /*** Start: Node rendering ***/
        node_classes(data) {
            return {
                [String(data.status || '').toLowerCase()]: !!data.status,
                locked: !!(
                    data.locked ||
                    (this.account && this.account.locked)
                ),
                managed: this.managed.includes(data.id),
                selected: this.selected_id === data.id
            };
        },

        node_icon(node, data) {
            if (data.status === 'ERROR') return tree_consts.ICON_ERROR;
            if (data.status === 'PENDING') return tree_consts.ICON_PROCESSING;
            if (data.type === 'dir') {
                if (!data.children || data.children.length === 0) {
                    return tree_consts.ICON_EMPTY_DIRECTORY;
                }
                return node.expanded
                    ? tree_consts.ICON_OPEN_DIRECTORY
                    : tree_consts.ICON_CLOSED_DIRECTORY;
            }
            if (data.web_file_type === 'data-grid')
                return tree_consts.ICON_GRID;
            return null;
        },
        /*** End: Node rendering ***/

        /*** Start: Tree events ***/
        node_clicked(data) {
            this.managed = [data.id];
        },

        node_dblclicked(data) {
            if (data.type === 'dir') return;
            this.selected_id = data.id;
            this.$emit('tree_item_selected', data);
        },

        node_expanded(data) {
            if (!this.expanded_keys.includes(data.id)) {
                this.expanded_keys = [...this.expanded_keys, data.id];
                save_open_folders(this.expanded_keys);
            }
        },

        node_collapsed(data) {
            this.expanded_keys = this.expanded_keys.filter(
                id => id !== data.id
            );
            save_open_folders(this.expanded_keys);
        },

        node_contextmenu(e, data) {
            e.preventDefault();
            this.managed = [data.id];
            // Kept inside the window (the menu is about 260 x 240)
            const x = Math.max(0, Math.min(e.clientX, window.innerWidth - 270));
            const y = Math.max(
                0,
                Math.min(e.clientY, window.innerHeight - 250)
            );
            this.context_menu = { x, y, item: data };
        },

        context_action(action, type) {
            const menu = this.context_menu;
            this.context_menu = null;
            if (!menu) return;
            const item = menu.item;
            if (action === 'add') {
                this.$emit('add_tree_item', type, item.id);
            } else if (action === 'open') {
                this.node_dblclicked(item);
            } else if (action === 'move') {
                this.$emit('move_to_folder', item);
            } else if (action === 'rename') {
                this.$emit('edit_tree_items', [item]);
            } else if (action === 'delete') {
                this.$emit('remove_tree_items', [item.id]);
            }
        },

        // Items are listed by name, so only moves to another folder (or the top level) count.
        // Folders stay at the top level (one level of folders).
        allow_drop(dragging, drop, type) {
            if (dragging.data.type === 'dir') {
                // Only an older nested folder can move: out to the top level
                return (
                    type !== 'inner' &&
                    !drop.data.parent_id &&
                    !!dragging.data.parent_id
                );
            }
            if (type === 'inner') return drop.data.type === 'dir';
            return (
                (dragging.data.parent_id || null) !==
                (drop.data.parent_id || null)
            );
        },

        node_dropped(dragging, drop, type) {
            const parent_id =
                type === 'inner' ? drop.data.id : drop.data.parent_id || null;
            this.$emit('move_tree_item', {
                moved_node: dragging.data,
                parent_id
            });
        },
        /*** End: Tree events ***/

        /*** Start: Event Handlers ***/
        remove_tree_items() {
            if (this.managed.length > 0) {
                this.$emit('remove_tree_items', this.managed);
            }
        },

        edit_tree_items() {
            if (this.managed.length > 0) {
                this.$emit(
                    'edit_tree_items',
                    this.managed.map(id => this.find_item(id)).filter(Boolean)
                );
            }
        },

        add_tree_item(item) {
            let parent_id = null;
            // A folder goes at the top level; a table in the managed folder (or beside the
            // managed table)
            if (item !== 'dir' && this.managed.length > 0) {
                const node = this.find_item(this.managed[0]);
                if (node) {
                    if (node.type === 'dir') parent_id = node.id;
                    else parent_id = node.parent_id;
                }
            }
            this.$emit('add_tree_item', item, parent_id);
        },
        /*** End: Event Handlers ***/

        /*** Start: Called by the parent (home) ***/
        select_tree_item_by_id(id) {
            if (!id) {
                this.selected_id = null;
                return;
            }
            const node = this.find_item(id);
            if (node && node.type !== 'dir') this.selected_id = node.id;
        },

        clear_managed_nodes() {
            this.managed = [];
        },

        managed_tree_item_by_id(id) {
            this.managed = id ? [id] : [];
        },
        /*** End: Called by the parent (home) ***/

        find_item(id) {
            let found = null;
            const search = items =>
                (items || []).some(item => {
                    if (item.id === id) found = item;
                    else search(item.children);
                    return !!found;
                });
            search(this.tree_items);
            return found;
        }
    }
};
