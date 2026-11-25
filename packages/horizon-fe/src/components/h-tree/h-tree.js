import { tree_consts } from './h-tree-consts';
import { store } from '@/store';
import { ai_http } from '@/core/context/ai/ai-http';

// The table/folder tree (an Element Plus el-tree; it was jqtree). Click "manages" (highlights)
// an item for the delete/rename buttons; double-click "selects" it, which opens it in a tab.
export default {
    name: 'HTree',

    props: ['tree_items'],

    emits: [
        'tree_item_selected',
        'add_tree_item',
        'remove_tree_items',
        'edit_tree_items',
        'move_tree_item'
    ],

    data: () => {
        return {
            account: null,
            account_subscription: null,

            // Ids of the items that are managed (highlighted)
            managed: [],

            // Id of the item open in the active tab
            selected_id: null,

            // Open folders, kept when the tree data is reloaded
            expanded_keys: [],

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
    },

    beforeUnmount() {
        document.body.removeEventListener('click', this.body_clicked);
        if (this.account_subscription) this.account_subscription.unsubscribe();
    },

    methods: {
        /*** Start: Global events ***/
        body_clicked(e) {
            if (!e.target.closest('.file-directory-menu')) {
                this.$refs.menu.close('1');
            }
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
            }
        },

        node_collapsed(data) {
            this.expanded_keys = this.expanded_keys.filter(
                id => id !== data.id
            );
        },

        // Items are listed by name, so only moves to another folder (or the top level) count
        allow_drop(dragging, drop, type) {
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
            if (this.managed.length > 0) {
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
