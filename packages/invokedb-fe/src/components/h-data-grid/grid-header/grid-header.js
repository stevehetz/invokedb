import { defineComponent, ref, onMounted } from 'vue';

export default defineComponent({
	name: 'GridHeader',

	setup(props) {
		const asc_sort = ref(null);
		const desc_sort = ref(null);
		const no_sort = ref(null);
		const indexed = ref(null);
		const col_type = ref({
			value: null,
			display: null,
		});
		const edit_obj = ref({
			display_name: '',
		});

		const event_handlers = () => {
			if (props.params.edit_mode) {
				column_type_menu_handlers();
			}
		};

		const column_type_menu_handlers = () => {
			let menu_timeout;
			const menu_toggle = ref(null);
			const menu = ref(null);

			const on_menu_toggle_click = () => {
				menu.value.classList.add('show');
			};

			const on_menu_toggle_enter = () => {
				window.clearTimeout(menu_timeout);
			};

			const on_menu_toggle_leave = () => {
				menu_timeout = window.setTimeout(() => {
					menu.value.classList.remove('show');
				}, 500);
			};

			const on_menu_mouse_enter = () => {
				window.clearTimeout(menu_timeout);
			};

			const on_menu_mouse_leave = () => {
				menu_timeout = window.setTimeout(() => {
					menu.value.classList.remove('show');
				}, 500);
			};

			const on_menu_mouse_click = () => {
				window.clearTimeout(menu_timeout);
				menu.value.classList.remove('show');
			};

			onMounted(() => {
				menu_toggle.value.addEventListener('click', on_menu_toggle_click);
				menu_toggle.value.addEventListener('mouseenter', on_menu_toggle_enter);
				menu_toggle.value.addEventListener('mouseleave', on_menu_toggle_leave);
				menu.value.addEventListener('mouseenter', on_menu_mouse_enter);
				menu.value.addEventListener('mouseleave', on_menu_mouse_leave);
				menu.value.addEventListener('click', on_menu_mouse_click);
			});
		};

		const get_col_type = (type) => {
			switch (type) {
				case 'number':
					return {
						value: 'number',
						display: '<span class="grid-header-type__menu__label number">#</span>',
					};
				case 'boolean':
					return {
						value: 'boolean',
						display: '<span class="grid-header-type__menu__label boolean">T/F</span>',
					};
				case 'date':
					return {
						value: 'date',
						display: `<span class="grid-header-type__menu__label date">
                                    <i class= "fa fa-calendar"></i>
                                  </span>`,
					};
				case 'string':
				default:
					return {
						value: 'string',
						display: '<span class="grid-header-type__menu__label string">" "</span>',
					};
			}
		};

		const value_change = (e) => {
			const { value } = e.target;
			const { colDef } = props.params.column;
			props.params.column.colDef = Object.assign({}, colDef, {
				headerName: value,
			});
			props.params.header_value_change({ field: colDef.field, value });
		};

		const index_change = () => {
			const { colDef } = props.params.column;
			indexed.value = !indexed.value;
			props.params.header_index_change({
				field: colDef.field,
				indexed: indexed.value,
			});
		};

		const on_sort_changed = () => {
			asc_sort.value = desc_sort.value = no_sort.value = 'inactive';
			if (props.params.column.isSortAscending()) {
				asc_sort.value = 'active';
			} else if (props.params.column.isSortDescending()) {
				desc_sort.value = 'active';
			} else {
				no_sort.value = 'active';
			}
		};

		const on_sort_requested = () => {
			if (props.params.header_clicked) {
				props.params.header_clicked();
			}

			if (!props.params.enableSorting) return;

			if (asc_sort.value === 'active') {
				props.params.setSort('desc');
			} else if (desc_sort.value === 'active') {
				props.params.setSort('');
			} else {
				props.params.setSort('asc');
			}
		};

		const on_delete_requested = () => {
			props.params.delete_header(props.params.column.colDef);
		};

		onMounted(() => {
			event_handlers();
			const { colDef } = props.params.column;
			col_type.value = get_col_type(colDef.col_type || 'string');
			indexed.value = !!colDef.indexed;
			edit_obj.value.display_name = props.params.displayName;
			props.params.column.addEventListener('sortChanged', on_sort_changed);
			on_sort_changed();
		});

		return {
			asc_sort,
			desc_sort,
			no_sort,
			indexed,
			col_type,
			edit_obj,
			value_change,
			index_change,
			on_sort_requested,
			on_delete_requested,
			column_type_menu_handlers,
		};
	},
});
