import Split from 'split.js';
import h_tree from '@/components/h-tree/index.vue';
import doc_container from '@/components/doc-container/index.vue';
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

export default {
	name: 'Home',

	components: {
		'h-tree': h_tree,
		'doc-container': doc_container,
	},

	data: function () {
		return {
			h_tree_state: [],
			tree_items: [],
			highlighted_tree_items: [],
			selected_tree_items: [],
			active_tab_name: null,
			tabs: [],
			dialog_visible: false,
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

	destroyed() {
		this.dom_remove_bindings();
	},

	methods: {
		/*** Start: Websocket handler ***/
		setup_websocket_handler() {
			bus.on('websocket:message', (data) => {
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
			});
		},

		web_file_process_start(message) {
			this.setup_tree();
			this.refresh_tabs(message.file);
		},

		web_file_process_complete(message) {
			this.setup_tree();
			this.refresh_tabs(message.file);
			bus.emit('notify:success', `Table ${message.file.name} is ready`);
		},

		web_file_process_error(message, error) {
			this.setup_tree();
			this.refresh_tabs(message.file);
			bus.emit(
				'notify:error',
				`Error processing ${message.file.name}: ${error || 'Server Error'}`,
			);
		},

		refresh_tabs(file) {
			let active_tab = null;
			this.tabs.forEach((t) => {
				if (t.name === this.active_tab_name) active_tab = t;
			});
			this.tabs = tab_manager.update_tab(this.tabs, new TabVo(file));
			this.decorate_tabs();
			this.tabs.filter((t) => {
				if (t.id === active_tab.id) this.active_tab_name = t.name;
			});
		},
		/*** End: Websocket handler ***/

		/*** Start: Setup resizable layout ***/
		setup_panes() {
			Split(['.left-pane', '.right-pane'], {
				sizes: [20, 80],
				minSize: 1,
				gutterSize: 8,
			});
		},
		/*** End: Setup resizable layout ***/

		/*** Start: Refresh tree data from server ***/
		async setup_tree() {
			try {
				this.tree_items = await tree_manager.get_tree();
			} catch (ex) {
				bus.emit('notify:error', {
					e: ex || 'Error retrieving tree data',
				});
			}
		},
		/*** End: Refresh tree data from server ***/

		/*** Start: Page level DOM bindings ***/
		dom_add_bindings() {
			let self = this;
			$('body').bind('click.home', (e) => {
				if ($(e.target).closest('.left-pane, .gutter, .dialog').length > 0) return;
				this.$refs.h_tree.clear_managed_nodes();
			});
		},

		dom_remove_bindings() {
			$('body').unbind('.home');
		},
		/*** End: Page level DOM bindings ***/

		/*** Start: Tree Handlers ***/
		handle_duplicate_opened_names() {
			this.tree_items = tree_manager.set_duplicate_opened_file_seq(
				this.tree_items,
				this.tabs,
			);
			this.$refs.h_tree.reload_tree_data();
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

		async remove_tree_items(tree_item_ids) {
			const tree_item = this.tree_items.find((t) => t.id === tree_item_ids[0]);
			const name = tree_item.name;
			bus.emit('confirm-dialog:open', {
				title: 'Delete Table',
				message: `Are you sure you want to delete table <b>${name}</b>?`,
				callback: async () => {
					try {
						await tree_manager.remove_items(tree_item_ids);
						await account_manager.refresh_account_store();
						this.$refs.h_tree.clear_managed_nodes();
						this.remove_tabs(tree_item_ids);
						this.setup_tree();
					} catch (ex) {
						bus.emit('notify:error', {
							e: ex || 'Item remove error',
						});
					}
				},
			});
		},

		async add_tree_item(type, parent_id) {
			if (type === 'upload') {
				this.upload_file(parent_id);
			} else {
				this.add_web_file(type, parent_id);
			}
		},

		async add_web_file(type, parent_id) {
			const name = type === 'dir' ? 'directory' : 'table';
			const title = 'Add ' + name;
			const placeholder = name.substring(0, 1).toUpperCase() + name.substring(1) + ' name';
			const callback = await this.add_web_file_confirmed.bind(this, type, parent_id);

			bus.emit('input-dialog:open', {
				title,
				placeholder,
				callback,
			});
		},

		async add_web_file_confirmed(type, parent_id, name) {
			try {
				bus.emit('input-dialog:processing', true);
				let fid = await tree_manager.add_item({
					type,
					parent_id,
					name,
				});
				await this.setup_tree();
				this.create_tab_from_tree_id(fid);
				this.select_and_manage_tree_item_by_id(fid);
				bus.emit('input-dialog:close');
			} catch (ex) {
				const r_msg = err_mgr.first_rule_msg('name', ex.rules);
				bus.emit('notify:error', r_msg || ex.message || 'File add error');
				bus.emit('input-dialog:processing', false);
			}
		},

		upload_file(parent_id) {
			const title = 'Upload CSV';
			const options = [
				{
					name: 'CSV to Data Grid',
					id: 'csv-to-grid',
					file_types: 'csv',
					upload_type: 'csv_to_data_grid',
				},
			];
			const http_handler = async (file_ctx, new_name, selected_option) => {
				let account = store.get('account');

				let data = {};
				if (parent_id) data.parent_id = parent_id;
				data.new_name = new_name;
				data.account_id = account.id;
				data.upload_type = selected_option.upload_type;

				await tree_manager.validate_file_directory(
					Object.assign({}, data, {
						type: 'file',
					}),
				);

				file_ctx.data = data;

				await tree_manager.file_upload(file_ctx);
			};

			const on_success = async (fid) => {
				await this.setup_tree();
				this.create_tab_from_tree_id(fid);
				this.select_and_manage_tree_item_by_id(fid);
			};

			bus.emit('upload-dialog:open', {
				title,
				options,
				http_handler,
				on_success,
			});
		},

		async edit_tree_items(items) {
			// Just supporting 1 item for now:
			let item = items[0];

			const name = item.type === 'dir' ? 'directory' : 'document';
			const title = 'Rename ' + name;
			const placeholder = name.substring(0, 1).toUpperCase() + name.substring(1) + ' name';
			const input_text = item.name;
			const callback = await this.handle_rename_tree_item.bind(this, item);

			bus.emit('input-dialog:open', {
				title,
				input_text,
				placeholder,
				callback,
			});
		},

		async handle_rename_tree_item(item, input_text) {
			// Create new item with new name entered in dialog
			let new_item = Object.assign({}, item, { name: input_text });
			// Store current active tab for later
			let active_tab = null;
			this.tabs.forEach((t) => {
				if (t.name === this.active_tab_name) active_tab = t;
			});

			try {
				// Try and update item on server
				let res = await tree_manager.update_item(new_item);
				await this.setup_tree();
				// Update the tab with the new name
				this.tabs = tab_manager.update_tab(this.tabs, new TabVo(res));
				// Decorate
				this.decorate_tabs();
				// Restore active tab
				this.tabs.filter((t) => {
					if (t.id === active_tab.id) this.active_tab_name = t.name;
				});
				bus.emit('input-dialog:close');
			} catch (ex) {
				bus.emit(
					'notify:error',
					err_mgr.first_rule_msg('name', ex.rules) || 'Item rename error',
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
				bus.emit('notify:error', {
					e: ex || 'Item move error',
				});
			}
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
				tab,
			);
			this.tabs = tabs;
			this.active_tab_name = active_tab_name;
			this.handle_duplicate_opened_names();
			this.decorate_tabs();
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
				targetName,
			);
			this.tabs = tabs;
			this.active_tab_name = active_tab_name;
			this.handle_duplicate_opened_names();
			let id = active_tab ? active_tab.id : null;
			this.$refs.h_tree.select_tree_item_by_id(id);
			this.$refs.h_tree.managed_tree_item_by_id(id);
		},

		remove_tabs(ids) {
			this.tabs.forEach((tab) => {
				if (ids.indexOf(tab.id) > -1) {
					this.remove_tab(tab.name);
				}
			});
		},

		tab_clicked(event) {
			let tab = this.get_tab_from_name(event.name);
			this.$refs.h_tree.select_tree_item_by_id(tab.id);
		},

		get_tab_from_name(name) {
			let tab = null;
			this.tabs.forEach((t) => {
				if (t.name === name) tab = t;
			});
			return tab;
		},

		decorate_tabs() {
			let self = this;
			window.setTimeout(() => {
				$('.el-tabs__item').each(function () {
					let $tab = $(this);
					$tab.find('i').remove();
					const icon = self.get_tab_icon($tab);
					$tab.prepend(icon + ' ');
				});
			}, 0);
		},

		get_tab_icon($icon) {
			const text = $icon.text();
			const ext = text.substring(text.length - 1);

			let icon = null;
			switch (ext) {
				case 'g':
					icon = tree_consts.ICON_GRID;
					break;
				case 'p':
					icon = tree_consts.ICON_PROCESSING;
					break;
				case 'e':
					icon = tree_consts.ICON_ERROR;
					break;
				default:
					icon = '';
					break;
			}

			return icon;
		},
		/*** End: Tab Handlers ***/
	},
};
