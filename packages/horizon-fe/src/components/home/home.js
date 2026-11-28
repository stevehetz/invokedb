// @ts-nocheck: not type-checked yet
import Split from 'split.js';
import h_tree from '@/components/h-tree';
import doc_container from '@/components/doc-container';
import onboarding from '@/components/onboarding';
import AiTableDialog from './ai-table-dialog';
import SchemaDiagram from './schema-diagram';
import MoveFolderDialog from './move-folder-dialog';
import { store } from '@/store';
import { bus } from '@/core/bus';
import { error_manager as err_mgr } from '@/core/error/error-manager';
import { tree_manager } from '@/components/h-tree/tree-manager';
import { tab_manager } from '@/components/tabs/tab-manager';
import { TabVo } from '@/components/tabs/tab-vo';
import { tree_consts } from '@/components/h-tree/h-tree-consts';
import { toggle_page_overlay } from '@/components/_page/page-overlay';
import { account_manager } from '@/core/context/account/account-manager';
import { logger } from '@/core/logger/logger';

// Names go into the confirm dialog's HTML
function escape_html(text) {
    return String(text).replace(
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

// The tables inside a folder, at any depth
function tables_in(folder) {
    const out = [];
    (folder.children || []).forEach(function visit(item) {
        if (item.type === 'dir') (item.children || []).forEach(visit);
        else out.push(item);
    });
    return out;
}

export default {
    name: 'Home',

    components: {
        'h-tree': h_tree,
        'doc-container': doc_container,
        onboarding
    },

    data: function () {
        return {
            h_tree_state: [],
            tree_items: [],
            highlighted_tree_items: [],
            selected_tree_items: [],
            active_tab_name: null,
            tabs: [],
            dialog_visible: false
        };
    },

    async mounted() {
        toggle_page_overlay(this.$route.path);
        this.setup_websocket_handler();
        this.setup_panes();
        await this.setup_tree();
        this.dom_remove_bindings(); // HMR Fix
        this.dom_add_bindings();
    },

    unmounted() {
        this.dom_remove_bindings();
        bus.$off('websocket:message', this.websocket_message);
        bus.$off('table:open', this.open_table);
        bus.$off('table:status', this.table_status);
    },

    methods: {
        /*** Start: Websocket handler ***/
        setup_websocket_handler() {
            bus.$on('websocket:message', this.websocket_message);
            // A link cell's chip opens the table it links to (#147)
            bus.$on('table:open', this.open_table);
            // A grid found its table's job done without a COMPLETE message (#190)
            bus.$on('table:status', this.table_status);
        },

        table_status(file) {
            this.setup_tree();
            this.refresh_tabs(file);
        },

        open_table(id) {
            const tree_item = this.file_tree_item_by_id(id);
            if (!tree_item || tree_item.type === 'dir') {
                this.$bus.$emit('notify:error', 'The linked table is gone');
                return;
            }
            this.tree_item_selected(tree_item);
            if (this.$refs.h_tree) this.$refs.h_tree.select_tree_item_by_id(id);
        },

        websocket_message(data) {
            const { event, message, error } = data;
            switch (event) {
                case 'WEB_FILE_PROCESS_START':
                    this.web_file_process_start(message);
                    break;
                case 'WEB_FILE_PROCESS_COMPLETE':
                    this.web_file_process_complete(message);
                    break;
                case 'WEB_FILE_PROCESS_ERROR':
                    this.web_file_process_error(message, error);
                    break;
            }
        },

        web_file_process_start(message) {
            this.setup_tree();
            this.refresh_tabs(message.file);
        },

        web_file_process_complete(message) {
            this.setup_tree();
            this.refresh_tabs(message.file);
            this.$bus.$emit(
                'notify:success',
                `Table ${message.file.name} is ready`
            );
        },

        web_file_process_error(message, error) {
            this.setup_tree();
            this.refresh_tabs(message.file);
            this.$bus.$emit(
                'notify:error',
                `Error processing ${message.file.name}: ${
                    error || 'Server Error'
                }`
            );
        },

        refresh_tabs(file) {
            let active_tab = null;
            this.tabs.forEach(t => {
                if (t.name === this.active_tab_name) active_tab = t;
            });
            this.tabs = tab_manager.update_tab(this.tabs, new TabVo(file));
            this.tabs.filter(t => {
                if (t.id === active_tab.id) this.active_tab_name = t.name;
            });
        },
        /*** End: Websocket handler ***/

        /*** Start: Setup resizable layout ***/
        setup_panes() {
            Split(['.left-pane', '.right-pane'], {
                sizes: [20, 80],
                minSize: 1,
                gutterSize: 8
            });
        },
        /*** End: Setup resizable layout ***/

        /*** Start: Refresh tree data from server ***/
        async setup_tree() {
            try {
                this.tree_items = await tree_manager.get_tree();
            } catch (ex) {
                this.$bus.$emit('notify:error', {
                    e: ex || 'Error retrieving tree data'
                });
            }
        },
        /*** End: Refresh tree data from server ***/

        /*** Start: Page level DOM bindings ***/
        dom_add_bindings() {
            document.body.addEventListener('click', this.body_clicked);
        },

        dom_remove_bindings() {
            document.body.removeEventListener('click', this.body_clicked);
        },

        // Clicking anywhere but the tree (or a dialog) clears the managed tree item
        body_clicked(e) {
            if (e.target.closest('.left-pane, .gutter, .dialog')) return;
            if (this.$refs.h_tree) this.$refs.h_tree.clear_managed_nodes();
        },
        /*** End: Page level DOM bindings ***/

        /*** Start: Tree Handlers ***/
        handle_duplicate_opened_names() {
            this.tree_items = tree_manager.set_duplicate_opened_file_seq(
                this.tree_items,
                this.tabs
            );
        },

        async tree_item_selected(tree_item) {
            if (tree_item.type === 'dir') return;
            let tab = new TabVo(tree_item);
            if (tab_manager.tab_exists(this.tabs, tab)) {
                let active_tab_name = tab_manager.select_tab(this.tabs, tab);
                if (active_tab_name) this.active_tab_name = active_tab_name;
            } else {
                this.create_tab(tab);
            }
        },

        // A folder goes with the tables in it (#357): the server deletes them through the same
        // path as a table deleted on its own; the warning says how many go
        async remove_tree_items(tree_item_ids) {
            const tree_item = this.file_tree_item_by_id(tree_item_ids[0]);
            if (!tree_item) return;
            const name = escape_html(tree_item.name);
            const is_dir = tree_item.type === 'dir';
            const contained = is_dir ? tables_in(tree_item) : [];
            let message = `Are you sure you want to delete table <b>${name}</b>?`;
            if (is_dir && contained.length === 0) {
                message = `Delete the empty folder <b>${name}</b>?`;
            } else if (is_dir) {
                const n = contained.length;
                message =
                    `The folder <b>${name}</b> has ${n} ${
                        n === 1 ? 'table' : 'tables'
                    } in it. Deleting the folder deletes ${
                        n === 1 ? 'that table' : `all ${n} tables`
                    } too, with their rows, views and webhooks. ` +
                    'Delete them?';
            }
            const closing = [...tree_item_ids, ...contained.map(t => t.id)];
            this.$bus.$emit('confirm-dialog:open', {
                title: is_dir ? 'Delete Folder' : 'Delete Table',
                message,
                callback: async () => {
                    try {
                        await tree_manager.remove_items(tree_item_ids);
                        await account_manager.refresh_account_store();
                        this.$refs.h_tree.clear_managed_nodes();
                        this.remove_tabs(closing);
                        this.setup_tree();
                    } catch (ex) {
                        this.$bus.$emit('notify:error', {
                            e: ex || 'Item remove error'
                        });
                    }
                }
            });
        },

        async add_tree_item(type, parent_id) {
            if (type === 'upload') {
                this.upload_file(parent_id);
            } else if (type === 'template') {
                this.add_from_template(parent_id);
            } else if (type === 'url') {
                this.add_from_url(parent_id);
            } else if (type === 'ai') {
                this.add_from_description(parent_id);
            } else {
                this.add_web_file(type, parent_id);
            }
        },

        async add_web_file(type, parent_id) {
            const name = type === 'dir' ? 'folder' : 'table';
            const title = 'Add ' + name;
            const placeholder =
                name.substring(0, 1).toUpperCase() +
                name.substring(1) +
                ' name';
            const callback = await this.add_web_file_confirmed.bind(
                this,
                type,
                parent_id
            );

            this.$bus.$emit('input-dialog:open', {
                title,
                placeholder,
                callback
            });
        },

        async add_web_file_confirmed(type, parent_id, name) {
            try {
                this.$bus.$emit('input-dialog:processing', true);
                let fid = await tree_manager.add_item({
                    type,
                    parent_id,
                    name
                });
                await this.setup_tree();
                this.create_tab_from_tree_id(fid);
                this.select_and_manage_tree_item_by_id(fid);
                this.$bus.$emit('input-dialog:close');
            } catch (ex) {
                const r_msg = err_mgr.first_rule_msg('name', ex.rules);
                this.$bus.$emit(
                    'notify:error',
                    r_msg || ex.message || 'File add error'
                );
                this.$bus.$emit('input-dialog:processing', false);
            }
        },

        async add_from_template(parent_id) {
            let templates;
            try {
                templates = await tree_manager.get_templates();
            } catch (ex) {
                this.$bus.$emit(
                    'notify:error',
                    ex.message || 'Could not load the templates'
                );
                return;
            }
            this.$bus.$emit('template-dialog:open', {
                templates,
                callback: async (template_id, name) => {
                    try {
                        const fid = await tree_manager.add_from_template(
                            template_id,
                            { name, parent_id }
                        );
                        await this.setup_tree();
                        this.create_tab_from_tree_id(fid);
                        this.select_and_manage_tree_item_by_id(fid);
                        this.$bus.$emit('template-dialog:close');
                    } catch (ex) {
                        const r_msg = err_mgr.first_rule_msg('name', ex.rules);
                        this.$bus.$emit(
                            'notify:error',
                            r_msg || ex.message || 'Table create error'
                        );
                        this.$bus.$emit('template-dialog:processing', false);
                    }
                }
            });
        },

        // A table from a Google Sheet or a CSV / JSON URL (#144). The server fetches it in the
        // background; the new tab shows "updating" until it's loaded, or the error.
        add_from_url(parent_id) {
            this.$bus.$emit('url-import-dialog:open', {
                callback: async form => {
                    try {
                        const fid = await tree_manager.add_from_url({
                            ...form,
                            parent_id
                        });
                        await this.setup_tree();
                        this.create_tab_from_tree_id(fid);
                        this.select_and_manage_tree_item_by_id(fid);
                        this.$bus.$emit('url-import-dialog:close');
                    } catch (ex) {
                        const r_msg = err_mgr.first_rule_msg(
                            'name',
                            ex && ex.rules
                        );
                        this.$bus.$emit(
                            'notify:error',
                            r_msg || (ex && ex.message) || 'Import error'
                        );
                        this.$bus.$emit('url-import-dialog:processing', false);
                    }
                }
            });
        },

        // A table the AI designs from a description (#148): previewed in the dialog, which
        // creates it; then it opens like any new table
        add_from_description(parent_id) {
            this.$bus.$emit('container-dialog:open', {
                title: 'New table from a description',
                props: {
                    parent_id,
                    on_created: async fid => {
                        await this.setup_tree();
                        this.create_tab_from_tree_id(fid);
                        this.select_and_manage_tree_item_by_id(fid);
                    }
                },
                component: AiTableDialog
            });
        },

        // The schema diagram (#208): every table and the links between them; clicking a
        // table opens it (through `table:open`)
        open_schema() {
            this.$bus.$emit('container-dialog:open', {
                title: 'Schema diagram',
                dialog_class: 'wide',
                props: {},
                component: SchemaDiagram
            });
        },

        upload_file(parent_id) {
            const title = 'Upload CSV';
            const options = [
                {
                    name: 'CSV to Data Grid',
                    id: 'csv-to-grid',
                    file_types: 'csv',
                    upload_type: 'csv_to_data_grid'
                }
            ];
            const http_handler = async (
                file_ctx,
                new_name,
                selected_option
            ) => {
                let account = store.get('account');

                let data = {};
                if (parent_id) data.parent_id = parent_id;
                data.new_name = new_name;
                data.account_id = account.id;
                data.upload_type = selected_option.upload_type;

                await tree_manager.validate_file_directory(
                    Object.assign({}, data, {
                        type: 'file'
                    })
                );

                file_ctx.data = data;

                await tree_manager.file_upload(file_ctx);
            };

            const on_success = async fid => {
                await this.setup_tree();
                this.create_tab_from_tree_id(fid);
                this.select_and_manage_tree_item_by_id(fid);
            };

            this.$bus.$emit('upload-dialog:open', {
                title,
                options,
                http_handler,
                on_success
            });
        },

        async edit_tree_items(items) {
            // Just supporting 1 item for now:
            let item = items[0];

            const name = item.type === 'dir' ? 'folder' : 'table';
            const title = 'Rename ' + name;
            const placeholder =
                name.substring(0, 1).toUpperCase() +
                name.substring(1) +
                ' name';
            const input_text = item.name;
            const callback = await this.handle_rename_tree_item.bind(
                this,
                item
            );

            this.$bus.$emit('input-dialog:open', {
                title,
                input_text,
                placeholder,
                callback
            });
        },

        async handle_rename_tree_item(item, input_text) {
            // Create new item with new name entered in dialog
            let new_item = Object.assign({}, item, { name: input_text });
            // Store current active tab for later
            let active_tab = null;
            this.tabs.forEach(t => {
                if (t.name === this.active_tab_name) active_tab = t;
            });

            try {
                // Try and update item on server
                let res = await tree_manager.update_item(new_item);
                await this.setup_tree();
                // Update the tab with the new name
                this.tabs = tab_manager.update_tab(this.tabs, new TabVo(res));
                // Restore active tab
                this.tabs.filter(t => {
                    if (t.id === active_tab.id) this.active_tab_name = t.name;
                });
                this.$bus.$emit('input-dialog:close');
            } catch (ex) {
                this.$bus.$emit(
                    'notify:error',
                    err_mgr.first_rule_msg('name', ex.rules) ||
                        'Item rename error'
                );
            }
        },

        async move_tree_item(data) {
            let { moved_node, parent_id } = data;
            moved_node.parent_id = parent_id;

            try {
                await tree_manager.update_item(moved_node);
                await this.setup_tree();
            } catch (ex) {
                // The tree already shows the drop: put it back as the server has it
                this.setup_tree();
                this.$bus.$emit('notify:error', {
                    e: ex || 'Item move error'
                });
            }
        },

        // "Move to folder…" in a table's right-click menu (#357)
        move_to_folder(item) {
            const folders = this.tree_items
                .filter(t => t.type === 'dir')
                .map(t => ({ id: t.id, name: t.name }));
            this.$bus.$emit('container-dialog:open', {
                title: 'Move to folder',
                props: {
                    item,
                    folders,
                    on_move: async parent_id => {
                        try {
                            await tree_manager.update_item({
                                ...item,
                                parent_id
                            });
                            await this.setup_tree();
                        } catch (ex) {
                            this.$bus.$emit('notify:error', {
                                e: ex || 'Item move error'
                            });
                            throw ex;
                        }
                    }
                },
                component: MoveFolderDialog
            });
        },

        file_tree_item_by_id(id) {
            let found_item = null;

            this.tree_items.forEach(function is_item(tree_item) {
                if (tree_item.id === parseInt(id)) found_item = tree_item;
                else if (tree_item.children && tree_item.children.length > 0)
                    tree_item.children.forEach(is_item);
            });

            return found_item;
        },

        select_and_manage_tree_item_by_id(id) {
            this.$refs.h_tree.select_tree_item_by_id(id);
            this.$refs.h_tree.managed_tree_item_by_id(id);
        },
        /*** End: Tree Handlers ***/

        /*** Start: Tab Handlers ***/
        create_tab(tab) {
            let { tabs, active_tab_name } = tab_manager.create_tab(
                this.tabs,
                this.active_tab_name,
                tab
            );
            this.tabs = tabs;
            this.active_tab_name = active_tab_name;
            this.handle_duplicate_opened_names();
        },

        create_tab_from_tree_id(id) {
            let tree_item = this.file_tree_item_by_id(id);

            if (tree_item.type === 'dir') return;
            let tab = new TabVo(tree_item);
            this.create_tab(tab);
        },

        remove_tab(targetName) {
            let { tabs, active_tab_name, active_tab } = tab_manager.remove_tab(
                this.tabs,
                this.active_tab_name,
                targetName
            );
            this.tabs = tabs;
            this.active_tab_name = active_tab_name;
            this.handle_duplicate_opened_names();
            let id = active_tab ? active_tab.id : null;
            this.$refs.h_tree.select_tree_item_by_id(id);
            this.$refs.h_tree.managed_tree_item_by_id(id);
        },

        remove_tabs(ids) {
            this.tabs.forEach(tab => {
                if (ids.indexOf(tab.id) > -1) {
                    this.remove_tab(tab.name);
                }
            });
        },

        tab_clicked(pane) {
            let tab = this.get_tab_from_name(pane.paneName);
            this.$refs.h_tree.select_tree_item_by_id(tab.id);
        },

        get_tab_from_name(name) {
            let tab = null;
            this.tabs.forEach(t => {
                if (t.name === name) tab = t;
            });
            return tab;
        },

        // Tab names end in a type suffix (.g grid, .p processing, .e error; see tab-manager),
        // shown as an icon instead

        tab_label(name) {
            return /\.[gpe]$/.test(name) ? name.slice(0, -2) : name;
        },

        tab_icon(name) {
            switch (name.slice(-2)) {
                case '.g':
                    return tree_consts.ICON_GRID;
                case '.p':
                    return tree_consts.ICON_PROCESSING;
                case '.e':
                    return tree_consts.ICON_ERROR;
                default:
                    return '';
            }
        }
        /*** End: Tab Handlers ***/
    }
};
