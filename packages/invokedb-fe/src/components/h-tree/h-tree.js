import { tree_consts } from './h-tree-consts';
import { store } from '@/store';
import { ref, watch, onMounted, onBeforeUnmount } from 'vue';

const $drag_background = $('<div class="drag-background"></div>');

export default {
	name: 'HTree',

	props: {
		treeItems: Array,
	},

	setup(props, { emit }) {
		const account = ref(null);
		const $tree = ref(null);
		const managed = ref([]);
		const treeState = ref({
			selected_node: [],
			open_nodes: [],
		});
		const dragMoveElement = ref(null);

		const domAddBindings = () => {
			$('body').on('click.htree', (e) => {
				const $t = $(e.target);
				if ($t.parents('.file-directory-menu').length === 0) {
					emit('closeMenu', '1');
				}
			});
		};

		const domRemoveBindings = () => {
			$('body').off('.htree');
		};

		const reloadTreeData = () => {
			addGhostFile();
			$tree.value.tree('loadData', props.treeItems);
			$tree.value.tree('setState', treeState.value);
			styleManagedItems();
			window.setTimeout(() => {
				hideGhostFile();
			}, 0);
		};

		const addGhostFile = () => {
			const lastItem = props.treeItems[props.treeItems.length - 1];
			if (!lastItem || !lastItem.ghost) {
				props.treeItems.push({
					id: -1,
					ghost: true,
					children: null,
					name: '',
					type: 'file',
					web_file_type: null,
					parent_id: null,
				});
			}
		};

		const hideGhostFile = () => {
			const $ghost = $('.jqtree-tree > li:last-child');
			$ghost.css('visibility', 'hidden');
		};

		const loadTree = () => {
			setJqTreeReference();
			setupTreeEventHandlers();
			initializeTree();
		};

		const setJqTreeReference = () => {
			$tree.value = $(document.querySelector('.tree'));
		};

		const setupTreeEventHandlers = () => {
			$tree.value.on('tree.select', function (event) {
				event.preventDefault();
			});

			$tree.value.on('tree.move', function (event) {
				event.preventDefault();

				const { moved_node, target_node } = event.move_info;

				let parent_id = null;

				if (target_node.type === 'file') {
					if (target_node.parent.id) {
						parent_id = target_node.parent.id;
					}
				} else {
					parent_id = target_node.id;
				}

				emit('moveTreeItem', { moved_node, parent_id });
				$tree.value.find('.drag-background').remove();
			});

			$tree.value.on('tree.open tree.close', function () {
				treeState.value = $tree.value.tree('getState');
			});

			$tree.value.on('tree.click', function (event) {
				event.preventDefault();
				managed.value = [event.node.id];
				styleManagedItemByNode(event.node);
			});

			$tree.value.on('tree.dblclick', function (event) {
				if (event.node.type === 'dir') return;
				$tree.value.tree('selectNode', event.node);
				treeState.value = $tree.value.tree('getState');
				emit('treeItemSelected', event.node);
			});
		};

		const initializeTree = () => {
			$tree.value.tree({
				data: props.treeItems,
				dragAndDrop: true,
				autoOpen: false,
				closedIcon: $(tree_consts.ICON_CLOSED_DIRECTORY),
				openedIcon: $(tree_consts.ICON_OPEN_DIRECTORY),
				onCreateLi: decorateTree,
				onCanMoveTo: canMoveTo,
				onDragMove: dragMove,
			});
		};

		const decorateTree = (node, $li) => {
			setStatus(node, $li);
			setLocked(node, $li);
			prependDupOpenSeq(node, $li);
			prependIcons(node, $li);
		};

		const setStatus = (node, $li) => {
			if (node.status) {
				$li.find('.jqtree-title').addClass(node.status.toLowerCase());
			}
		};

		const setLocked = (node, $li) => {
			if (node.locked || account.value.locked) {
				$li.find('.jqtree-title').addClass('locked');
			}
		};

		const prependDupOpenSeq = (node, $li) => {
			if (!node.dup_opened_seq) return;
			$li.find('.jqtree-title').prepend(`(${node.dup_opened_seq}) `);
		};

		const prependIcons = (node, $li) => {
			if (node.status === 'ERROR') {
				$li.find('.jqtree-title').prepend(wrapIcon(tree_consts.ICON_ERROR));
			} else if (node.status === 'PENDING') {
				$li.find('.jqtree-title').prepend(wrapIcon(tree_consts.ICON_PROCESSING));
			} else if (node.type === 'dir' && node.children.length === 0) {
				$li.find('.jqtree-title').prepend(wrapIcon(tree_consts.ICON_EMPTY_DIRECTORY));
			} else if (node.web_file_type === 'data-grid') {
				$li.find('.jqtree-title').prepend(wrapIcon(tree_consts.ICON_GRID));
			}
		};

		const wrapIcon = (icon_html) => {
			return `<span class="icon-wrapper">${icon_html}</span>`;
		};

		const canMoveTo = (moved_node, target_node) => {
			$tree.value.find('.drag-background').remove();
			const canMove = canMoveTreeItem(moved_node, target_node);

			if (canMove) {
				let target_element = null;
				if (target_node.type === 'file') {
					target_element =
						target_node.parent.element || $tree.value.find('.jqtree-tree')[0];
				} else {
					target_element = target_node.element;
				}
				const offset_left = offset(target_element).left;
				$drag_background.css({
					left: offset_left * -1,
					width: `calc(100% + ${offset_left + 16}px)`,
				});
				if (target_element) $(target_element).append($drag_background);
			}

			return canMove;
		};

		const canMoveTreeItem = (item, target) => {
			let canMove = false;

			if (target.type === 'dir') {
				canMove = true;
			} else if (item.parent_id !== target.parent_id) {
				canMove = true;
			}

			return canMove;
		};

		const dragMove = (node, event) => {
			$tree.value.find('.drag-background').remove();
			if (event) {
				dragMoveElement.value = event.target;
				console.log(dragMoveElement.value);
			}
		};

		const removeTreeItems = () => {
			if (managed.value.length > 0) {
				emit('removeTreeItems', managed.value);
			}
		};

		const editTreeItems = () => {
			if (managed.value.length > 0) {
				emit(
					'editTreeItems',
					managed.value.map((id) => {
						return $tree.value.tree('getNodeById', id);
					}),
				);
			}
		};

		const addTreeItem = (item) => {
			let parent_id = null;
			if (managed.value.length > 0) {
				const managed_id = managed.value[0];
				const node = $tree.value.tree('getNodeById', managed_id);

				if (node) {
					parent_id = node.type === 'dir' ? node.id : node.parent_id;
				}
			}
			emit('addTreeItem', item, parent_id);
		};

		const selectTreeItemById = (id) => {
			if (!id) {
				treeState.value.selected_node = [];
				$tree.value.tree('setState', treeState.value);
			} else {
				const node = $tree.value.tree('getNodeById', id);
				if (node.type === 'dir') return;
				if (treeState.value.selected_node.indexOf(node.id) < 0) {
					$tree.value.tree('selectNode', node);
					treeState.value = $tree.value.tree('getState');
				}
			}
		};

		const styleManagedItems = () => {
			managed.value.forEach(styleManagedItemById);
		};

		const clearManagedNodes = () => {
			managed.value = [];
			$tree.value.find('.highlighter').remove();
		};

		const managedTreeItemById = (id) => {
			if (!id) {
				clearManagedNodes();
			} else {
				managed.value = [id];
				styleManagedItemById(id);
			}
		};

		const styleManagedItemById = (id) => {
			if (!id) return;
			const node = $tree.value.tree('getNodeById', id);
			styleManagedItemByNode(node);
		};

		const styleManagedItemByNode = (node) => {
			$tree.value.find('.highlighter').remove();
			const $element = $(node.element).find('.jqtree-element')[0];
			const $highlighter = $('<div class="highlighter"></div>');
			const offset_left = offset($element).left;
			$highlighter.css({
				left: (offset_left - 40) * -1,
				width: `calc(100% + ${offset_left - 25}px)`,
			});
			$($element).prepend($highlighter);
		};

		const offset = (el) => {
			const rect = el.getBoundingClientRect();
			const scrollLeft = window.pageXOffset || document.documentElement.scrollLeft;
			const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
			return { top: rect.top + scrollTop, left: rect.left + scrollLeft };
		};

		watch(
			() => props.treeItems,
			() => {
				reloadTreeData();
			},
		);

		onMounted(() => {
			store.subscribe('account', (newAccount) => {
				account.value = newAccount;
				domRemoveBindings();
				domAddBindings();
				loadTree();
			});
		});

		onBeforeUnmount(() => {
			domRemoveBindings();
		});

		return {
			account,
			$tree,
			managed,
			treeState,
			dragMoveElement,
			reloadTreeData,
			removeTreeItems,
			editTreeItems,
			addTreeItem,
			selectTreeItemById,
			managedTreeItemById,
			styleManagedItems,
			clearManagedNodes,
		};
	},
};
