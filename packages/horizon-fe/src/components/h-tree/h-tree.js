import { tree_consts } from './h-tree-consts';
import { store } from '@/store';

const $drag_background = $('<div class="drag-background"></div>');

export default {
    name: 'HTree',

    props: ['tree_items'],

    data: () => {
        return {
            account: null,

            // Reference to jqtree object
            $tree: null,

            // Nodes that is managed (Highlighted)
            managed: [],

            // Tree state for reloading
            tree_state: {
                // Nodes that are selected
                selected_node: [],
                // Nodes that are open
                open_nodes: []
            },

            drag_move_element: null
        };
    },

    watch: {
        tree_items: function () {
            this.reload_tree_data();
        }
    },

    mounted() {
        store.subscribe('account', account => {
            this.account = account;
            this.dom_remove_bindings();
            this.dom_add_bindings();
            this.load_tree();
        });
    },

    destroyed() {
        this.dom_remove_bindings();
    },

    methods: {
        /*** Start: Global events ***/
        dom_add_bindings() {
            $('body').bind('click.htree', e => {
                let $t = $(e.target);
                if ($t.parents('.file-directory-menu').length === 0)
                    this.$refs.menu.close('1');
            });
        },

        dom_remove_bindings() {
            $('body').unbind('.htree');
        },
        /*** End: Global events ***/

        /*** Start: Reload tree and state ***/
        reload_tree_data() {
            this.add_ghost_file();
            this.$tree.tree('loadData', this.tree_items);
            this.$tree.tree('setState', this.tree_state);
            this.style_managed_items();
            window.setTimeout(() => {
                this.hide_ghost_file();
            }, 0);
        },
        /*** End: Reload tree and state ***/

        /*** Start: Load tree - kicked off when component is mounted ***/
        add_ghost_file() {
            let last_item = this.tree_items[this.tree_items.length - 1];
            if (!last_item || !last_item.ghost) {
                this.tree_items.push({
                    id: -1,
                    ghost: true,
                    children: null,
                    name: '',
                    type: 'file',
                    web_file_type: null,
                    parent_id: null
                });
            }
        },

        hide_ghost_file() {
            let $ghost = $('.jqtree-tree > li:last-child');
            $ghost.css('visibility', 'hidden');
        },

        load_tree: function () {
            this.set_jq_tree_reference();
            this.setup_tree_event_handlers();
            this.initialize_tree();
        },

        set_jq_tree_reference() {
            this.$tree = $(this.$refs.tree);
        },

        setup_tree_event_handlers() {
            let self = this;

            this.$tree.bind('tree.select', function (event) {
                event.preventDefault();
            });

            this.$tree.bind('tree.move', function (event) {
                event.preventDefault();

                let { moved_node, target_node } = event.move_info;

                // If parent_id is null, move to root
                let parent_id = null;

                if (target_node.type === 'file') {
                    // If target is a doc, find parent

                    if (target_node.parent.id) {
                        // Parent directory found
                        parent_id = target_node.parent.id;
                    }
                } else {
                    // Target is a directory
                    parent_id = target_node.id;
                }

                self.$emit('move_tree_item', { moved_node, parent_id });
                self.$tree.find('.drag-background').remove();
            });

            this.$tree.bind('tree.open', function (event) {
                self.tree_state = self.$tree.tree('getState');
            });

            this.$tree.bind('tree.close', function (event) {
                self.tree_state = self.$tree.tree('getState');
            });

            // Manage - For tree management
            this.$tree.bind('tree.click', function (event) {
                event.preventDefault();
                self.managed = [event.node.id];
                self.style_managed_item_by_node(event.node);
            });

            // Select - For parent to bind to a second component such
            // as tabs
            this.$tree.bind('tree.dblclick', function (event) {
                if (event.node.type === 'dir') return;
                self.$tree.tree('selectNode', event.node);
                self.tree_state = self.$tree.tree('getState');
                self.$emit('tree_item_selected', event.node);
            });
        },

        initialize_tree() {
            let self = this;
            this.$tree.tree({
                data: this.tree_items,
                dragAndDrop: true,
                autoOpen: false,
                closedIcon: $(tree_consts.ICON_CLOSED_DIRECTORY),
                openedIcon: $(tree_consts.ICON_OPEN_DIRECTORY),
                onCreateLi: self.decorate_tree.bind(self),
                onCanMoveTo: self.can_move_to.bind(self),
                onDragMove: self.drag_move.bind(self)
            });
        },

        decorate_tree(node, $li) {
            this.set_status(node, $li);
            this.set_locked(node, $li);
            this.prepend_dup_open_seq(node, $li);
            this.prepend_icons(node, $li);
        },

        set_status(node, $li) {
            if (node.status) {
                $li.find('.jqtree-title').addClass(node.status.toLowerCase());
            }
        },

        set_locked(node, $li) {
            if (node.locked || this.account.locked) {
                $li.find('.jqtree-title').addClass('locked');
            }
        },

        prepend_dup_open_seq(node, $li) {
            if (!node.dup_opened_seq) return;
            $li.find('.jqtree-title').prepend('(' + node.dup_opened_seq + ') ');
        },

        prepend_icons(node, $li) {
            if (node.status === 'ERROR') {
                $li.find('.jqtree-title').prepend(
                    this.wrap_icon(tree_consts.ICON_ERROR)
                );
            } else if (node.status === 'PENDING') {
                $li.find('.jqtree-title').prepend(
                    this.wrap_icon(tree_consts.ICON_PROCESSING)
                );
            } else if (node.type === 'dir' && node.children.length === 0) {
                $li.find('.jqtree-title').prepend(
                    this.wrap_icon(tree_consts.ICON_EMPTY_DIRECTORY)
                );
            } else if (node.web_file_type === 'data-grid') {
                $li.find('.jqtree-title').prepend(
                    this.wrap_icon(tree_consts.ICON_GRID)
                );
            }
        },

        wrap_icon(icon_html) {
            return `<span class="icon-wrapper">${icon_html}</span>`;
        },

        can_move_to(moved_node, target_node) {
            this.$tree.find('.drag-background').remove();
            let canMove = this.can_move_tree_item(moved_node, target_node);

            if (canMove) {
                let target_element = null;
                if (target_node.type === 'file') {
                    if (target_node.parent.element) {
                        target_element = target_node.parent.element;
                    } else {
                        target_element = $(this.$tree).find('.jqtree-tree')[0];
                    }
                } else {
                    target_element = target_node.element;
                }
                const offset_left = this.offset(target_element).left;
                $drag_background.css({
                    left: offset_left * -1,
                    width: 'calc(100% + ' + (offset_left + 16) + 'px)'
                });
                if (target_element) $(target_element).append($drag_background);
            }

            return canMove;
        },

        can_move_tree_item(item, target) {
            let canMove = false;

            if (target.type === 'dir') {
                canMove = true;
            } else if (item.parent_id !== target.parent_id) {
                canMove = true;
            }

            return canMove;
        },

        drag_move(node, event) {
            this.$tree.find('.drag-background').remove();
            if (event) {
                this.drag_move_element = event.target;
                console.log(this.drag_move_element);
            }
        },
        /*** End: Load tree - kicked off when component is mounted ***/

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
                    this.managed.map(id => {
                        return this.$tree.tree('getNodeById', id);
                    })
                );
            }
        },

        add_tree_item(item) {
            let parent_id = null;
            if (this.managed.length > 0) {
                let managed_id = this.managed[0];
                let node = this.$tree.tree('getNodeById', managed_id);

                if (node) {
                    if (node.type === 'dir') parent_id = node.id;
                    else parent_id = node.parent_id;
                }
            }
            this.$emit('add_tree_item', item, parent_id);
        },
        /*** End: Event Handlers ***/

        /*** Start: Select Items ***/
        select_tree_item_by_id(id) {
            if (!id) {
                this.tree_state.selected_node = [];
                this.$tree.tree('setState', this.tree_state);
            } else {
                const node = this.$tree.tree('getNodeById', id);
                if (node.type === 'dir') return;
                if (this.tree_state.selected_node.indexOf(node.id) < 0) {
                    this.$tree.tree('selectNode', node);
                    this.tree_state = this.$tree.tree('getState');
                }
            }
        },
        /*** Start: Select Items ***/

        /*** Start: Manage Items ***/
        style_managed_items() {
            this.managed.forEach(this.style_managed_item_by_id);
        },

        clear_managed_nodes() {
            this.managed = [];
            this.$tree.find('.highlighter').remove();
        },

        managed_tree_item_by_id(id) {
            if (!id) {
                this.clear_managed_nodes();
            } else {
                this.managed = [id];
                this.style_managed_item_by_id(id);
            }
        },

        style_managed_item_by_id(id) {
            if (!id) return;
            const node = this.$tree.tree('getNodeById', id);
            this.style_managed_item_by_node(node);
        },

        style_managed_item_by_node(node) {
            this.$tree.find('.highlighter').remove();
            let $element = $(node.element).find('.jqtree-element')[0];
            let $highlighter = $('<div class="highlighter"></div>');
            const offset_left = this.offset($element).left;
            $highlighter.css({
                left: (offset_left - 40) * -1,
                width: 'calc(100% + ' + (offset_left - 25) + 'px)'
            });
            $($element).prepend($highlighter);
        },
        /*** Start: Manage Items ***/

        /*** Start: DOM Helpers ***/
        offset(el) {
            let rect = el.getBoundingClientRect(),
                scrollLeft =
                    window.pageXOffset || document.documentElement.scrollLeft,
                scrollTop =
                    window.pageYOffset || document.documentElement.scrollTop;
            return { top: rect.top + scrollTop, left: rect.left + scrollLeft };
        }
        /*** End: DOM Helpers ***/
    }
};
