// @ts-nocheck: not type-checked yet
import _ from 'lodash';
import { markRaw } from 'vue';
import {
    ColumnApiModule,
    InfiniteRowModelModule,
    ModuleRegistry,
    RenderApiModule,
    RowSelectionModule,
    RowStyleModule,
    TextEditorModule,
    TextFilterModule,
    UndoRedoEditModule,
    ValidationModule
} from 'ag-grid-community';
import { AgGridVue } from 'ag-grid-vue3';
import { data_grid_manager as mgr } from './data-grid-manager';
import { grid_theme } from './grid-theme';
import { bus } from '@/core/bus';
import GridHeader from './grid-header';
import GridFilter from './grid-filter';
import GridToast from './grid-toast';
import ApiDialog from './api-dialog';

// Since ag-grid 33 every feature is a module that has to be registered. Only the ones the grid
// uses are, so the rest of ag-grid is left out of the bundle (AllCommunityModule was 1.3 MB).
// Sorting, column moving and resizing and header components are in the core module. A new
// grid option, column def property or `api.*` call may need a module added here: in dev,
// ValidationModule logs which one is missing (ag-grid error #200).
ModuleRegistry.registerModules([
    InfiniteRowModelModule, // rowModelType: 'infinite', refreshInfiniteCache
    TextFilterModule, // filter: true, the floating filter's parent filter
    TextEditorModule, // editable: true
    UndoRedoEditModule, // undoRedoCellEditing, stopEditing
    RowSelectionModule, // rowSelection, getSelectedNodes, deselectAll
    RowStyleModule, // rowClassRules
    ColumnApiModule, // getAllGridColumns, setColumnsVisible
    RenderApiModule, // refreshHeader
    ...(import.meta.env.DEV ? [ValidationModule] : [])
]);

const PAGE_SIZE = 50;
const ADD_ROW_MODE_ROW_COUNT = 4;

const ROW_INDEX_COLUMN = {
    order: '0',
    width: 70,
    field: 'row_num',
    headerName: 'Row',
    suppressMovable: true,
    suppressHeaderMenuButton: true,
    editable: false,
    lockPosition: true,
    resizable: false
};

export default {
    name: 'HDataGrid',

    props: ['file_directory_id', 'web_file_type', 'file'],

    // GridHeader and GridFilter are registered so the grid can find them by name
    // (defaultColDef.headerComponent, colDef.floatingFilterComponent).
    components: {
        'ag-grid-vue': AgGridVue,
        'grid-toast': GridToast,
        GridHeader,
        GridFilter
    },

    data() {
        return {
            table_lock: false,
            total_rows: 0,
            processing: false,
            top_bar_show: false,
            top_bar_message: null,
            total_rows_with_row_filter: null,
            edit_column_mode: false,
            edit_column_changes: {},
            edit_column_count: 0,
            saving_columns: false,
            disable_add_column: false,
            delete_columns: [],
            add_row_mode: false,
            show_delete_rows: false
        };
    },

    // ag-grid owns and mutates its options, column defs and row data, so they stay out of
    // Vue's reactivity (Vue would wrap them in proxies).
    created() {
        this.toast = null;
        this.grid_api = null;
        this.cached_col_defs = [];
        this.add_data = [];
        this.new_rows = [];
        this.grid_options = markRaw({
            theme: grid_theme,
            rowData: null,
            columnDefs: null,
            rowHeight: 30,
            // stylesheet.scss draws the header row at 35px and the filter row at 30px
            headerHeight: 35,
            floatingFiltersHeight: 30,
            rowModelType: 'infinite',
            // Click selects a row (ctrl/shift for more); no checkbox column
            rowSelection: {
                mode: 'multiRow',
                enableClickSelection: true,
                enableSelectionWithoutKeys: false,
                checkboxes: false,
                headerCheckbox: false
            },
            // Column defs carry the backend's own fields (_id, order, col_type...)
            suppressPropertyNamesCheck: true,
            cacheBlockSize: PAGE_SIZE,
            defaultColDef: this.get_default_col_def(),
            rowClassRules: this.get_row_class_rules(),
            onGridReady: params => this.grid_ready(params),
            onColumnVisible: this.column_visible,
            onCellValueChanged: this.cell_value_changed,
            onSelectionChanged: this.selection_changed,
            onCellClicked: this.cell_clicked,
            onCellDoubleClicked: this.cell_double_clicked,
            onViewportChanged: this.viewport_changed,
            onDragStopped: e => this.drag_stopped(e),
            onBodyScroll: e => this.body_scrolled(e),
            undoRedoCellEditing: true
        });
    },

    /*** Start: Mounted ***/
    mounted() {
        this.toast = this.$refs.grid_toast;
        this.setup_websocket_handler();
    },

    beforeUnmount() {
        bus.$off('websocket:message', this.websocket_message);
    },
    /*** End: Mounted ***/

    computed: {
        /*** Start: Debounced grid handlers ***/
        drag_stopped() {
            return _.debounce(e => {
                this.show_top_bar_info('Saving...', 1000);
                const orig_defs = e.api
                    .getAllGridColumns()
                    .map(c => c.getColDef());
                const new_defs = e.api
                    .getAllGridColumns()
                    .filter((c, i) => {
                        const col_def = c.getColDef();
                        if (
                            col_def.width !== c.getActualWidth() ||
                            parseInt(col_def.order) !== i
                        ) {
                            col_def.width = c.getActualWidth();
                            col_def.order = i;
                            return true;
                        }
                        return false;
                    })
                    .map(column => column.getColDef());

                mgr.save_columns(this.file_directory_id, orig_defs, new_defs);
            }, 100);
        }
        /*** End: Debounced grid handlers ***/
    },

    methods: {
        grid_ready(params) {
            this.grid_api = markRaw(params.api);
            if (this.file.status === 'PENDING') {
                this.set_table_load_pending();
            } else if (this.file.status === 'ERROR') {
                this.set_table_load_error(this.file);
            } else {
                this.load_table();
            }
        },

        // ag-grid scrolls the header by setting scrollLeft on .ag-header-viewport, but
        // stylesheet.scss makes that viewport overflow: visible (so the column-type and
        // filter-type menus can hang below the header), which stops it scrolling. Move the
        // header along with the body ourselves.
        body_scrolled(e) {
            if (e.direction !== 'horizontal') return;
            const header = this.$el.querySelector(
                '.ag-header-viewport .ag-header-container'
            );
            if (header) header.style.transform = `translateX(${-e.left}px)`;
        },

        setup_websocket_handler() {
            bus.$on('websocket:message', this.websocket_message);
        },

        websocket_message(data) {
            const { event, message } = data;
            if (
                message &&
                message.file &&
                message.file.id === this.file_directory_id
            ) {
                switch (event) {
                    case 'WEB_FILE_PROCESS_START':
                        this.set_table_load_pending();
                        break;
                    case 'WEB_FILE_PROCESS_COMPLETE':
                        this.load_table();
                        break;
                    case 'WEB_FILE_PROCESS_ERROR':
                        this.set_table_load_error(message.file);
                        break;
                }
            }
        },

        set_table_load_pending() {
            this.table_lock = true;
            this.processing = true;
        },

        set_table_load_error(file) {
            let err_msg = file.status_reason ? file.status_reason : null;
            if (err_msg) {
                this.toast.error(err_msg);
                this.table_lock = true;
                this.processing = false;
            } else {
                this.load_table();
            }
        },

        async load_table() {
            this.table_lock = false;
            this.processing = false;
            this.show_top_bar_info('Loading...');

            try {
                // Get Columns
                await mgr.get_columns(this.file_directory_id, this.grid_api, {
                    ...ROW_INDEX_COLUMN
                });
                this.cache_columns();

                this.edit_column_changes = {};
                this.delete_columns = [];
                this.set_column_lock(false);
                this.set_all_columns_edit_mode(false);
                this.edit_column_mode = false;
                this.edit_column_count = Object.keys(
                    this.edit_column_changes
                ).length;
                this.grid_api.refreshHeader();
                this.set_datasource(this.get_rows);
                this.table_lock = false;
                this.saving_columns = false;
                this.processing = false;

                if (this.file.locked && this.file.locked_reason) {
                    this.toast.error(this.file.locked_reason, 3000, {
                        lock: true
                    });
                }
                this.hide_top_bar_msg();
                this.toast.hide();
            } catch (ex) {
                this.hide_top_bar_msg();
                this.toast.hide();
                this.table_lock = true;
                if (ex.status === 403) {
                    this.toast.error(ex.message);
                } else {
                    this.toast.error('Error loading table data');
                }
            }
        },

        /*** Start: Info Bar ***/
        show_top_bar_msg(msg, duration) {
            const show = () => {
                this.top_bar_message = msg;
                this.top_bar_show = true;
            };

            if (duration) {
                show();
                window.setTimeout(() => this.hide_top_bar_msg(), duration);
            } else {
                show();
            }
        },

        show_top_bar_info(msg, duration) {
            this.show_top_bar_msg(
                `<i class="info-icon fa fa-info-circle"></i> ${msg}`,
                duration
            );
        },

        show_top_bar_success(msg, duration) {
            console.log(msg);
            this.show_top_bar_msg(
                `<i class="success-icon fa fa-check"></i> ${msg}`,
                duration
            );
        },

        hide_top_bar_msg() {
            this.top_bar_show = false;
        },

        /*** End: Info Bar ***/

        /*** Start: Grid Option Configuration ***/
        get_row_class_rules() {
            return {
                'add-row-mode': () => this.add_row_mode,
                'new-row': params => params.data && !params.data._id
            };
        },

        get_default_col_def() {
            return {
                editable: true,
                sortable: true,
                filter: true,
                floatingFilter: true,
                resizable: true,
                headerComponent: 'GridHeader',
                headerComponentParams: {
                    edit_mode: false,
                    delete_header: this.delete_header,
                    header_clicked: this.header_clicked,
                    header_value_change: this.header_value_change,
                    header_type_change: this.header_type_change,
                    header_index_change: this.header_index_change
                }
            };
        },
        /*** End: Grid Option Configuration ***/

        /*** Start: Retrieve paged rows from server ***/
        async get_rows(params) {
            this.show_top_bar_info('Loading...');
            const col_defs = this.col_defs();
            let res = await mgr.get_rows(
                this.file_directory_id,
                params,
                PAGE_SIZE,
                col_defs
            );
            this.total_rows = res.count;
            let last_row = res.count <= params.endRow ? res.count : -1;
            params.successCallback(res.data, last_row);
            this.hide_top_bar_msg();
            this.toast.hide();
        },
        /*** End: Retrieve paged rows from server ***/

        /*** Start: AgGrid - event handlers ***/
        viewport_changed(e) {
            if (e.lastRow < 0) return;
            if (this.add_row_mode) {
                this.cover_add_row_mode_header();
                this.cover_add_row_mode_rows();
            } else {
                this.clear_add_row_mode_covers();
            }
        },

        selection_changed(e) {
            this.show_delete_rows = this.grid_api.getSelectedNodes().length > 0;
        },

        column_visible(e) {
            if (e.column) e.api.setColumnsVisible([e.column], true);
        },

        async cell_value_changed(e) {
            let oldValue =
                e.oldValue === '' ||
                e.oldValue === null ||
                e.oldValue === undefined
                    ? null
                    : e.oldValue;
            let newValue =
                e.newValue === '' ||
                e.newValue === null ||
                e.newValue === undefined
                    ? null
                    : e.newValue;

            try {
                if (e.colDef.col_type === 'number') {
                    oldValue = parseInt(oldValue, 10);
                    newValue = parseInt(newValue, 10);
                }
            } catch (ex) {}

            if (this.add_row_mode || newValue === oldValue) return;
            try {
                const row = await mgr.update_row(
                    this.file_directory_id,
                    e.data
                );
                if (row && row._id) {
                    row.row_num = e.data.row_num;
                    e.node.setData(row);
                }
                this.show_top_bar_success('Saved', 1000);
            } catch (ex) {
                if (ex.status === 403) {
                    this.toast.error(ex.message, 3000);
                } else {
                    this.toast.error('Error saving rows', 2000);
                }
                const field = e.colDef.field;
                const data = Object.assign({}, e.data, {
                    [field]: oldValue
                });
                e.node.setData(data);
            }
        },

        cell_clicked(e) {},

        cell_double_clicked(e) {},
        /*** End: AgGrid - event handlers ***/

        /*** Start: Header controls - event handlers ***/
        refresh_clicked() {
            this.grid_api.refreshInfiniteCache();
        },

        upload_clicked() {
            logger.debug('upload_clicked');
        },

        refresh_col_defs() {
            this.set_column_defs(this.col_defs());
        },

        edit_columns_clicked() {
            this.cache_columns();
            this.edit_column_mode = true;
            this.set_all_columns_edit_mode(true);
            this.set_column_lock(true);
        },

        cache_columns() {
            this.cached_col_defs = this.col_defs().map(c =>
                Object.assign({}, c)
            );
        },

        async add_column_clicked() {
            this.disable_add_column = true;
            let col_defs = this.col_defs();

            const new_col = await mgr.get_new_column(this.file_directory_id);
            new_col.edit_mode = true;

            col_defs.push(new_col);

            this.set_column_defs(col_defs);

            col_defs = this.col_defs();
            const length = col_defs.length;

            this.set_column_edit_mode(col_defs[length - 1], true);
            this.set_column_defs(col_defs);
            this.set_column_lock(true);
            this.scroll_horizontal_end();
            this.disable_add_column = false;
        },

        scroll_horizontal_end() {
            const $scoll_container = this.$el.querySelector(
                '.ag-body-horizontal-scroll-viewport'
            );
            const width = $scoll_container.scrollWidth;
            $scoll_container.scrollLeft = width;
        },

        cancel_clicked() {
            if (this.add_row_mode) {
                this.reset_rows();
                this.add_row_mode = false;
            } else if (this.edit_column_mode) {
                this.reset_columns();
            }

            this.grid_api.deselectAll();
            this.grid_api.stopEditing();
        },

        reset_columns() {
            this.set_column_defs(
                this.cached_col_defs.map(c => Object.assign({}, c))
            );
            this.cached_col_defs = [];
            this.delete_columns = [];
            this.edit_column_changes = {};
            this.edit_column_mode = false;
            this.edit_column_count = 0;
        },

        async save_clicked() {
            if (this.edit_column_mode) {
                this.saving_columns = true;
                try {
                    this.table_lock = true;
                    this.processing = true;
                    const edit_map = this.edit_column_changes;

                    await this.save_columns_from_edit_map(edit_map);
                } catch (ex) {
                    if (ex.name === 'Validation' || ex.status === 403) {
                        this.toast.error(ex.message, 3000);
                    } else {
                        this.toast.error('Error saving columns', 2000);
                    }
                    this.saving_columns = false;
                    this.processing = false;
                    this.table_lock = false;
                }
            } else if (this.add_row_mode) {
                this.show_top_bar_info('Saving...');
                this.grid_api.stopEditing();
                try {
                    await mgr.save_rows(this.file_directory_id, this.new_rows);
                    this.reset_rows();
                    console.log('here');
                    this.show_top_bar_success('Saved', 1500);
                } catch (ex) {
                    this.hide_top_bar_msg();
                    if (ex.status === 403) {
                        this.toast.error(ex.message, 3000);
                    } else {
                        this.toast.error('Error saving rows', 2000);
                    }
                }
            }
        },

        is_header_name_valid(names, name) {
            const regex = new RegExp(/^[A-Za-z0-9-_\s\.\$!]+$/, 'g');
            if (names.includes(name)) {
                throw {
                    name: 'Validation',
                    message: `Header name already exists: ${name}`
                };
            } else if (name.trim() === '') {
                throw {
                    name: 'Validation',
                    message: 'Header name cannot be empty'
                };
            } else if (!regex.test(name)) {
                throw {
                    name: 'Validation',
                    message:
                        'Column names can only contain: A-Za-z0-9-_$!. and spaces'
                };
            } else if (name.length > 100) {
                throw {
                    name: 'Validation',
                    message:
                        'Column value cannot be greater than 100 characters'
                };
            }
        },

        async save_columns_from_edit_map(edit_map) {
            const header_names = [];

            const col_defs = this.col_defs().map(col_def => {
                const colDef = Object.assign({}, col_def);
                const { field } = colDef;

                if (edit_map[field]) {
                    if (edit_map[field].value) {
                        colDef.headerName = edit_map[field].value;
                    }
                    if (edit_map[field].col_type) {
                        colDef.col_type = edit_map[field].col_type;
                    }
                    if (edit_map[field].indexed === true) {
                        colDef.indexed = true;
                    } else {
                        delete colDef.indexed;
                    }
                }

                this.is_header_name_valid(header_names, colDef.headerName);

                header_names.push(colDef.headerName);

                return colDef;
            });

            const filtered = col_defs.filter(c => edit_map[c.field]);

            const res = await mgr.save_columns(
                this.file_directory_id,
                this.col_defs(),
                filtered,
                this.delete_columns
            );

            // if res !== 'done' then batch job has been queued
            if (res === 'done') {
                this.load_table();
            }
        },

        delete_header(col_def) {
            const col_defs = this.col_defs().filter(
                def => def.field !== col_def.field
            );
            if (col_def._id) {
                this.delete_columns.push(col_def);
            }
            this.set_column_defs(col_defs);
        },

        header_clicked() {
            this.show_delete_rows = false;
        },

        header_value_change(data) {
            const { field, value } = data;
            this.edit_column_changes[field] =
                this.edit_column_changes[field] || {};
            this.edit_column_changes[field].value = value;
            this.edit_column_count = Object.keys(
                this.edit_column_changes
            ).length;
        },

        header_type_change(data) {
            const { field, col_type } = data;
            this.edit_column_changes[field] =
                this.edit_column_changes[field] || {};
            this.edit_column_changes[field].col_type = col_type;
            this.edit_column_count = Object.keys(
                this.edit_column_changes
            ).length;
        },

        header_index_change(data) {
            const { field, indexed } = data;
            this.edit_column_changes[field] =
                this.edit_column_changes[field] || {};
            this.edit_column_changes[field].indexed = indexed;
            this.edit_column_count = Object.keys(
                this.edit_column_changes
            ).length;
        },

        set_all_columns_edit_mode(mode) {
            const col_defs = this.col_defs().map(c =>
                this.set_column_edit_mode(c, mode)
            );
            this.set_column_defs(col_defs);
        },

        set_column_edit_mode(col_def, mode) {
            if (col_def.field !== 'row_num') {
                const p = Object.assign({}, col_def.headerComponentParams);
                p.edit_mode = mode;
                col_def.headerComponentParams = p;
            }
            return col_def;
        },

        set_column_lock(lock) {
            const col_defs = this.col_defs().map(def => {
                let col_def = Object.assign({}, def);
                if (col_def.field === 'row_num') {
                    col_def.sortable = !lock;
                    col_def.filter = !lock;
                } else {
                    col_def.lockPosition = lock;
                    col_def.sortable = !lock;
                    col_def.filter = !lock;
                    // col_def.resizable = !lock;
                    col_def.editable = !lock;
                }

                return col_def;
            });

            this.set_column_defs(col_defs);
        },

        async add_row_clicked() {
            await this.set_add_row_mode();
        },

        async delete_rows_clicked() {
            let selected = this.grid_api.getSelectedNodes();
            if (this.add_row_mode) {
                let selected_indexes = selected.map(s => s.data.new_row_index);
                this.new_rows = this.new_rows.filter(
                    r => selected_indexes.indexOf(r.new_row_index) === -1
                );
                let data = this.add_data.concat(this.new_rows);
                data = mgr.number_new_rows(data, this.total_rows);
                this.set_datasource(params =>
                    params.successCallback(data, data.length)
                );
            } else {
                this.show_top_bar_info('Saving...', 1500);
                let ids = selected.map(s => s.data._id);
                await mgr.remove_rows(this.file_directory_id, ids);
                this.grid_api.refreshInfiniteCache();
                this.show_top_bar_success('Saved', 1000);
            }
            this.grid_api.deselectAll();
        },

        api_btn_clicked() {
            this.$bus.$emit('container-dialog:open', {
                title: this.file.name.replace(/.g/, ''),
                props: {
                    file: this.file
                },
                component: ApiDialog
            });
        },
        /*** End: Header controls event handlers ***/

        /*** Start: Add Mode ***/
        async set_add_row_mode() {
            this.set_column_defs(
                this.col_defs().map(c => Object.assign({}, c))
            );
            this.show_delete_rows = false;
            this.set_datasource(this.add_row_mode_get_rows);
        },

        async add_row_mode_get_rows(params) {
            if (!this.add_row_mode) {
                this.show_top_bar_info('Loading...');
                this.add_row_mode = true;

                const { count } = await mgr.get_rows(
                    this.file_directory_id,
                    { startRow: 0 },
                    1
                );

                let params = mgr.get_add_row_mode_params(
                    count,
                    ADD_ROW_MODE_ROW_COUNT
                );
                let res = await mgr.get_rows(
                    this.file_directory_id,
                    params,
                    PAGE_SIZE
                );
                this.add_data = res.data;
            }
            let data = mgr.add_new_row(
                this.add_data,
                this.new_rows,
                this.total_rows,
                this.file_directory_id
            );
            params.successCallback(data, data.length);
            this.hide_top_bar_msg();
        },

        cover_add_row_mode_header() {
            this.$el
                .querySelectorAll('.ag-header-container .ag-header-row')
                .forEach(row => {
                    const cover = document.createElement('div');
                    cover.className = 'header-cover';
                    row.prepend(cover);
                });
        },

        cover_add_row_mode_rows() {
            const container = this.$el.querySelector(
                '.ag-center-cols-container'
            );
            if (!container) return;
            const rows_to_cover =
                ADD_ROW_MODE_ROW_COUNT > this.total_rows
                    ? this.total_rows
                    : ADD_ROW_MODE_ROW_COUNT;
            const first_row = container.querySelector('.ag-row[row-id="0"]');
            const height = first_row ? first_row.offsetHeight : 0;
            for (let i = 0; i < rows_to_cover; i++) {
                const cover = document.createElement('div');
                cover.className = 'row-cover';
                cover.style.height = height + 'px';
                cover.style.top = height * i + 'px';
                container.prepend(cover);
            }
        },

        clear_add_row_mode_covers() {
            this.$el
                .querySelectorAll('.header-cover, .row-cover')
                .forEach(el => el.remove());
        },

        /*** End: Add Mode ***/

        /*** Start: Grid Helpers ***/
        reset_rows() {
            this.new_rows = [];
            this.add_data = [];
            this.add_row_mode = false;
            this.set_datasource(this.get_rows);
            this.grid_api.deselectAll();
        },

        // Copies, so changing one and passing it back counts as a change to the grid
        col_defs() {
            return this.grid_api
                .getAllGridColumns()
                .map(c => ({ ...c.getColDef() }));
        },

        set_column_defs(col_defs) {
            this.grid_api.setGridOption('columnDefs', col_defs);
        },

        set_datasource(get_rows) {
            this.grid_api.setGridOption('datasource', { getRows: get_rows });
        }
        /*** End: Grid Helpers ***/
    }
};
