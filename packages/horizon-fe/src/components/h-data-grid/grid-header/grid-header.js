import Vue from 'vue';

export default Vue.extend({
    data() {
        return {
            asc_sort: null,
            desc_sort: null,
            no_sort: null,
            indexed: null,
            col_type: {
                value: null,
                display: null
            },
            edit_obj: {
                display_name: ''
            }
        };
    },

    mounted() {
        this.event_handlers();
        const { colDef } = this.params.column;
        this.col_type = this.get_col_type(colDef.col_type || 'string');
        this.indexed = !!colDef.indexed;
        this.edit_obj.display_name = this.params.displayName;
        this.params.column.addEventListener(
            'sortChanged',
            this.on_sort_changed
        );
        this.on_sort_changed();
    },

    methods: {
        event_handlers() {
            if (this.params.edit_mode) {
                this.column_type_menu_handlers();
            }
        },

        column_type_menu_handlers() {
            let menu_timeout;
            const { menu_toggle, menu } = this.$refs;

            const on_menu_toggle_click = e => {
                menu.classList.add('show');
            };

            const on_menu_toggle_enter = e => {
                window.clearTimeout(menu_timeout);
            };

            const on_menu_toggle_leave = e => {
                menu_timeout = window.setTimeout(() => {
                    menu.classList.remove('show');
                }, 500);
            };

            const on_menu_mouse_enter = e => {
                window.clearTimeout(menu_timeout);
            };

            const on_menu_mouse_leave = e => {
                menu_timeout = window.setTimeout(() => {
                    menu.classList.remove('show');
                }, 500);
            };

            const on_menu_mouse_click = e => {
                window.clearTimeout(menu_timeout);
                menu.classList.remove('show');
            };

            menu_toggle.addEventListener('click', on_menu_toggle_click);
            menu_toggle.addEventListener('mouseenter', on_menu_toggle_enter);
            menu_toggle.addEventListener('mouseleave', on_menu_toggle_leave);
            menu.addEventListener('mouseenter', on_menu_mouse_enter);
            menu.addEventListener('mouseleave', on_menu_mouse_leave);
            menu.addEventListener('click', on_menu_mouse_click);
        },

        on_change_column_type(type) {
            this.col_type = this.get_col_type(type);
            const { colDef } = this.params.column;
            this.params.header_type_change({
                field: colDef.field,
                col_type: type
            });
        },

        get_col_type(type) {
            switch (type) {
                case 'number':
                    return {
                        value: 'number',
                        display:
                            '<span class="grid-header-type__menu__label number">#</span>'
                    };
                case 'boolean':
                    return {
                        value: 'boolean',
                        display:
                            '<span class="grid-header-type__menu__label boolean">T/F</span>'
                    };
                case 'date':
                    return {
                        value: 'date',
                        display: `<span class="grid-header-type__menu__label date">
                                    <i class= "fa fa-calendar"></i>
                                  </span>`
                    };
                case 'string':
                default:
                    return {
                        value: 'string',
                        display:
                            '<span class="grid-header-type__menu__label string">" "</span>'
                    };
            }
        },

        value_change(e) {
            const { value } = e.target;
            const { colDef } = this.params.column;
            this.params.column.colDef = Object.assign({}, colDef, {
                headerName: value
            });
            this.params.header_value_change({ field: colDef.field, value });
        },

        index_change() {
            const { colDef } = this.params.column;
            this.indexed = !this.indexed;
            this.params.header_index_change({
                field: colDef.field,
                indexed: this.indexed
            });
        },

        on_sort_changed() {
            this.asc_sort = this.desc_sort = this.no_sort = 'inactive';
            if (this.params.column.isSortAscending()) {
                this.asc_sort = 'active';
            } else if (this.params.column.isSortDescending()) {
                this.desc_sort = 'active';
            } else {
                this.no_sort = 'active';
            }
        },

        on_sort_requested() {
            if (this.params.header_clicked) {
                this.params.header_clicked();
            }

            if (!this.params.enableSorting) return;

            if (this.asc_sort === 'active') {
                this.params.setSort('desc');
            } else if (this.desc_sort === 'active') {
                this.params.setSort('');
            } else {
                this.params.setSort('asc');
            }
        },

        on_delete_requested() {
            this.params.delete_header(this.params.column.colDef);
        }
    }
});
