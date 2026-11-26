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
import { to_grid, from_grid, col_meta } from './col-def';
import { bus } from '@/core/bus';
import { web_file_http } from '@/core/context/web-file/web-file-http';
import GridHeader from './grid-header';
import GridFilter from './grid-filter';
import GridToast from './grid-toast';
import ApiDialog from './api-dialog';
import WebhooksDialog from './webhooks-dialog';
import FormsDialog from './forms-dialog';
import AuditLog from '../audit-log';
import AskDialog from './ask-dialog';
import { ai_http } from '@/core/context/ai/ai-http';
import LinkDialog from './link-dialog';
import ViewsDialog from './views-dialog';
import KanbanView from './kanban-view';
import ChartView from './chart-view';
import CalendarView from './calendar-view';
import MapView from './map-view';
import { VIEW_TYPE_ICONS } from './views-dialog/views-dialog';
import { view_http } from '@/core/context/view/view-http';
import { table_display_name } from './table-name';
import AiColumnDialog from './ai-column-dialog';
import { ai_column_http } from '@/core/context/ai-column/ai-column-http';

// Why an AI column's cell is empty (#205), from the row's `_ai` state
const AI_CELL_NOTES = {
    limit: "Not filled: this month's AI rows are used up",
    paused: 'Not filled: AI is paused until next month',
    off: 'Not filled: AI is off',
    error: "Not filled: the AI didn't answer"
};

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
// The first status check of a locked table, doubling up to the max (#190)
const PENDING_CHECK_FIRST_MS = 5000;
const PENDING_CHECK_MAX_MS = 60000;
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
        'kanban-view': KanbanView,
        'chart-view': ChartView,
        'calendar-view': CalendarView,
        'map-view': MapView,
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
            show_delete_rows: false,
            // Where the table was imported from (#144), or null
            url_source: null,
            // Saved views (#146): the table's, and the one shown (null: the plain grid)
            views: [],
            current_view: null,
            // Bumped to reload the kanban board or chart
            view_version: 0,
            view_icons: VIEW_TYPE_ICONS,
            // AI is on (#148, #149): shows "Ask" and "Generate rows"
            ai_available: false,
            // How many of toolbar_order are folded into the More menu (fit_toolbar)
            toolbar_tucked: 0
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
        // What link cells (#147) show: { field: { row id: label } }, from the row pages
        this.link_labels = {};
        // The table's AI columns (#205), by field
        this.ai_fields = new Set();
        // Fields the current view hides (#146); column_visible() leaves them hidden
        this.hidden_fields = new Set();
        // fit_toolbar's observer of the top bar, its pending frame and its re-entry guard
        this.toolbar_observer = null;
        this.toolbar_frame = null;
        this.fitting_toolbar = false;
        // While the table is locked waiting for a job (or after a failed load), a timer checks
        // the table's status and reloads it once it isn't PENDING (#190)
        this.pending_timer = null;
        this.pending_delay = 0;
        this.pending_token = 0;
        this.grid_options = markRaw({
            theme: grid_theme,
            rowData: null,
            columnDefs: null,
            rowHeight: 30,
            // stylesheet.scss draws the header row at 35px and the filter row at 30px
            headerHeight: 35,
            floatingFiltersHeight: 30,
            // ag-grid 36 adds a clear (×) button to its text inputs; the Row column's
            // built-in floating filter would show it as a second box once it has a value
            suppressInputClearButton: true,
            rowModelType: 'infinite',
            // Click selects a row (ctrl/shift for more); no checkbox column
            rowSelection: {
                mode: 'multiRow',
                enableClickSelection: true,
                enableSelectionWithoutKeys: false,
                checkboxes: false,
                headerCheckbox: false
            },
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
        this.watch_toolbar();
    },

    beforeUnmount() {
        if (this.toolbar_observer) this.toolbar_observer.disconnect();
        if (this.toolbar_frame) cancelAnimationFrame(this.toolbar_frame);
        bus.$off('websocket:message', this.websocket_message);
        this.stop_pending_check();
    },
    /*** End: Mounted ***/

    computed: {
        // The top bar's buttons, in the order they fold into the More menu when the bar
        // doesn't fit (from the right); Views keeps its button and only drops its label
        toolbar_order() {
            const order = ['ask', 'forms', 'webhooks', 'api', 'views_label'];
            return this.ai_available ? order : order.slice(1);
        },

        // A kanban board or chart is shown instead of the grid
        other_view() {
            return !!this.current_view && this.current_view.type !== 'grid';
        },

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
                        const meta = col_meta(col_def);
                        if (
                            col_def.width !== c.getActualWidth() ||
                            parseInt(meta.order) !== i
                        ) {
                            col_def.width = c.getActualWidth();
                            col_def.context = { ...meta, order: i };
                            return true;
                        }
                        return false;
                    })
                    .map(column => column.getColDef());

                mgr.save_columns(
                    this.file_directory_id,
                    orig_defs.map(from_grid),
                    new_defs.map(from_grid)
                );
            }, 100);
        }
        /*** End: Debounced grid handlers ***/
    },

    methods: {
        grid_ready(params) {
            this.grid_api = markRaw(params.api);
            this.load_url_source();
            this.load_views();
            this.load_ai_status();
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
                        // The backend sends START and COMPLETE without waiting for each
                        // other, so a START can arrive after its COMPLETE. Its file is read
                        // when it's sent: if that isn't PENDING, the job is already done.
                        if (message.file.status !== 'PENDING') break;
                        this.set_table_load_pending();
                        break;
                    case 'WEB_FILE_PROCESS_COMPLETE':
                        this.load_table();
                        this.load_url_source();
                        break;
                    case 'WEB_FILE_PROCESS_ERROR':
                        this.set_table_load_error(message.file, data.error);
                        this.load_url_source();
                        break;
                    case 'AI_COLUMN_FILLED':
                        this.ai_column_filled();
                        break;
                }
            }
        },

        set_table_load_pending() {
            this.table_lock = true;
            this.processing = true;
            this.pending_delay = 0;
            this.schedule_pending_check();
        },

        // A START whose COMPLETE was missed (or came first) would leave the grid locked, so
        // while it's locked, check the table's status with a growing delay and reload it as
        // soon as no job is running on it.
        schedule_pending_check() {
            this.stop_pending_check();
            this.pending_delay = Math.min(
                this.pending_delay
                    ? this.pending_delay * 2
                    : PENDING_CHECK_FIRST_MS,
                PENDING_CHECK_MAX_MS
            );
            const token = this.pending_token;
            this.pending_timer = window.setTimeout(
                () => this.check_pending(token),
                this.pending_delay
            );
        },

        stop_pending_check() {
            if (this.pending_timer) window.clearTimeout(this.pending_timer);
            this.pending_timer = null;
            // A check already waiting on the server is ignored when it returns
            this.pending_token++;
        },

        async check_pending(token) {
            let file;
            try {
                file = await web_file_http.get_file(this.file_directory_id);
            } catch (ex) {
                if (token === this.pending_token) this.schedule_pending_check();
                return;
            }
            if (token !== this.pending_token) return;
            this.pending_timer = null;
            // The table is gone: the tree closes its tab
            if (!file) return;
            if (file.status === 'PENDING') {
                this.schedule_pending_check();
                return;
            }
            // The tree and tab may still show the table as processing
            bus.$emit('table:status', file);
            if (file.status === 'ERROR') {
                this.set_table_load_error(file);
            } else {
                this.load_table();
            }
        },

        set_table_load_error(file, error) {
            let err_msg = file.status_reason ? file.status_reason : null;
            if (err_msg) {
                this.stop_pending_check();
                this.toast.error(err_msg);
                this.table_lock = true;
                this.processing = false;
            } else {
                // A failed URL re-sync (#144) leaves the table as it was
                if (error) this.toast.error(`Sync failed: ${error}`);
                this.load_table();
            }
        },

        async load_url_source() {
            try {
                const res = await web_file_http.get_url_source(
                    this.file_directory_id
                );
                this.url_source = (res && res.source) || null;
            } catch (ex) {
                this.url_source = null;
            }
        },

        url_source_clicked() {
            this.$bus.$emit('url-import-dialog:open', {
                source: this.url_source,
                callback: async (form, sync_now) => {
                    try {
                        const res = await web_file_http.update_url_source(
                            this.file_directory_id,
                            {
                                url: form.url,
                                mode: form.mode,
                                key_column: form.key_column,
                                schedule: form.schedule
                            }
                        );
                        this.url_source = (res && res.source) || null;
                        if (sync_now) {
                            await web_file_http.sync_url_source(
                                this.file_directory_id
                            );
                            this.set_table_load_pending();
                        }
                        this.$bus.$emit('url-import-dialog:close');
                    } catch (ex) {
                        this.$bus.$emit(
                            'notify:error',
                            (ex && ex.message) || 'Could not save the source'
                        );
                        this.$bus.$emit('url-import-dialog:processing', false);
                    }
                }
            });
        },

        async load_table() {
            this.stop_pending_check();
            this.table_lock = false;
            this.processing = false;
            this.show_top_bar_info('Loading...');

            try {
                // Get Columns
                this.link_labels = {};
                this.ai_fields = await this.load_ai_columns();
                await mgr.get_columns(
                    this.file_directory_id,
                    this.grid_api,
                    { ...ROW_INDEX_COLUMN },
                    this.render_link_cell
                );
                if (this.ai_fields.size > 0) {
                    this.set_column_defs(
                        this.col_defs().map(c => this.ai_col_def(c))
                    );
                }
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
                this.restore_view_columns();
                this.set_datasource(this.get_rows);
                this.table_lock = false;
                this.saving_columns = false;
                this.processing = false;
                this.pending_delay = 0;

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
                    // Refresh is disabled while locked, so try again by itself
                    this.schedule_pending_check();
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
            this.add_link_labels(res);
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

        // Columns stay visible, except the ones the current view hides
        column_visible(e) {
            if (
                e.column &&
                !this.hidden_fields.has(e.column.getColDef().field)
            ) {
                e.api.setColumnsVisible([e.column], true);
            }
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
                if (col_meta(e.colDef).col_type === 'number') {
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

        cell_double_clicked(e) {
            if (col_meta(e.colDef).col_type === 'link') this.pick_links(e);
        },
        /*** End: AgGrid - event handlers ***/

        /*** Start: Link columns (#147) ***/
        add_link_labels(res) {
            const labels = (res && res.link_labels) || {};
            Object.keys(labels).forEach(field => {
                this.link_labels[field] = Object.assign(
                    this.link_labels[field] || {},
                    labels[field]
                );
            });
        },

        // A link cell: one chip per linked row, labelled by its display column. Clicking a
        // chip opens the linked table; double-clicking the cell picks its rows.
        render_link_cell(params) {
            const cell = document.createElement('span');
            cell.className = 'link-cell';
            const ids = Array.isArray(params.value) ? params.value : [];
            const field = params.colDef.field;
            const labels = this.link_labels[field] || {};
            ids.forEach(id => {
                const chip = document.createElement('span');
                chip.className = 'link-chip';
                chip.textContent = labels[id] || id;
                chip.title = 'Open the linked table';
                chip.addEventListener('click', ev => {
                    ev.stopPropagation();
                    this.open_linked_table(col_meta(params.colDef));
                });
                cell.appendChild(chip);
            });
            return cell;
        },

        open_linked_table(col_def) {
            if (col_def && col_def.link_table_id) {
                this.$bus.$emit('table:open', col_def.link_table_id);
            }
        },

        pick_links(e) {
            if (
                this.edit_column_mode ||
                this.table_lock ||
                this.saving_columns
            ) {
                return;
            }
            const field = e.colDef.field;
            const is_new = this.add_row_mode || !e.data._id;
            if (this.add_row_mode && !is_new) return;
            const labels = this.link_labels[field] || {};
            const current = Array.isArray(e.data[field]) ? e.data[field] : [];
            this.$bus.$emit('container-dialog:open', {
                title: `${e.colDef.headerName}: linked rows`,
                props: {
                    mode: 'pick',
                    file: this.file,
                    field,
                    column_name: e.colDef.headerName,
                    selected: current.map(id => ({
                        _id: id,
                        label: labels[id] || id
                    })),
                    on_save: async chosen => {
                        const ids = chosen.map(c => c._id);
                        this.link_labels[field] = this.link_labels[field] || {};
                        chosen.forEach(
                            c => (this.link_labels[field][c._id] = c.label)
                        );
                        const value = ids.length > 0 ? ids : null;
                        if (is_new) {
                            // Saved with the other new rows
                            e.data[field] = value;
                            this.grid_api.refreshCells({
                                rowNodes: [e.node],
                                columns: [field],
                                force: true
                            });
                            return;
                        }
                        const row = await mgr.update_row(
                            this.file_directory_id,
                            {
                                ...e.data,
                                [field]: value
                            }
                        );
                        if (row && row._id) {
                            row.row_num = e.data.row_num;
                            e.node.setData(row);
                        }
                        this.show_top_bar_success('Saved', 1000);
                    }
                },
                component: LinkDialog
            });
        },

        // Which table a link column points to, and which of its columns names a row
        edit_link_settings(field, revert) {
            const col_def = this.col_defs().find(c => c.field === field) || {};
            const change = this.edit_column_changes[field] || {};
            this.$bus.$emit('container-dialog:open', {
                title: 'Link column',
                props: {
                    mode: 'settings',
                    file: this.file,
                    link_table_id:
                        change.link_table_id || col_def.link_table_id,
                    link_display_field:
                        change.link_display_field || col_def.link_display_field,
                    on_save: settings => {
                        this.edit_column_changes[field] =
                            this.edit_column_changes[field] || {};
                        Object.assign(this.edit_column_changes[field], {
                            col_type: 'link',
                            link_table_id: settings.link_table_id,
                            link_display_field: settings.link_display_field
                        });
                        this.edit_column_count = Object.keys(
                            this.edit_column_changes
                        ).length;
                    },
                    on_cancel: () => {
                        if (revert) revert();
                    }
                },
                component: LinkDialog
            });
        },
        /*** End: Link columns ***/

        /*** Start: Header controls - event handlers ***/
        refresh_clicked() {
            this.grid_api.refreshInfiniteCache();
            if (this.other_view) this.view_version++;
        },

        upload_clicked() {
            logger.debug('upload_clicked');
        },

        refresh_col_defs() {
            this.set_column_defs(this.col_defs());
        },

        edit_columns_clicked() {
            // Every column can be edited, the ones the view hides too
            this.hidden_fields = new Set();
            this.apply_hidden_columns();
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

            // Columns added in this edit and not saved yet, including ones deleted again in it
            // (their batch delete runs on save): the server won't hand them out again
            const saved = new Set(
                (this.cached_col_defs || []).map(c => String(c._id))
            );
            const pending = [...col_defs, ...(this.delete_columns || [])]
                .filter(c => c._id && !saved.has(String(c._id)))
                .map(c => String(c._id));
            const new_col = await mgr.get_new_column(
                this.file_directory_id,
                pending
            );
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
            this.restore_view_columns();
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
                    if (edit_map[field].link_table_id) {
                        colDef.link_table_id = edit_map[field].link_table_id;
                        colDef.link_display_field =
                            edit_map[field].link_display_field;
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
            } else if (res === 'queued') {
                this.set_table_load_pending();
            }
        },

        delete_header(grid_def) {
            const col_def = from_grid(grid_def);
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
            // A link column needs its table first; the change counts once that's saved
            if (col_type === 'link') {
                this.edit_link_settings(field, data.revert);
                return;
            }
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
                } else if (col_def.col_type === 'link') {
                    // Picked in a dialog (double-click), not typed, sorted or filtered
                    col_def.lockPosition = lock;
                    col_def.sortable = false;
                    col_def.filter = false;
                    col_def.editable = false;
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
                // Paged, as there can be many new rows once rows are generated (#148)
                this.set_datasource(this.generated_rows_get_rows);
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
                title: table_display_name(this.file.name),
                props: {
                    file: this.file
                },
                component: ApiDialog
            });
        },

        webhooks_btn_clicked() {
            this.$bus.$emit('container-dialog:open', {
                title: `${table_display_name(this.file.name)}: webhooks`,
                props: {
                    file: this.file
                },
                component: WebhooksDialog
            });
        },

        forms_btn_clicked() {
            this.$bus.$emit('container-dialog:open', {
                title: `${table_display_name(this.file.name)}: forms`,
                props: {
                    file: this.file
                },
                component: FormsDialog
            });
        },

        // The top bar's More menu: room for table tools without widening the bar
        more_command(command) {
            if (command === 'api') this.api_btn_clicked();
            if (command === 'webhooks') this.webhooks_btn_clicked();
            if (command === 'forms') this.forms_btn_clicked();
            if (command === 'ask') this.ask_btn_clicked();
            if (command === 'history') this.history_btn_clicked();
            if (command === 'ai_columns') this.ai_columns_btn_clicked();
        },

        /*** Start: Top bar fit (#297) ***/
        // Is this top-bar button folded into the More menu?
        tucked(name) {
            const i = this.toolbar_order.indexOf(name);
            return i !== -1 && i < this.toolbar_tucked;
        },

        // Refit whenever the bar or what's on it changes size: the pane is resized, or a
        // button, the view's name or a message comes and goes
        watch_toolbar() {
            if (typeof ResizeObserver === 'undefined') return;
            this.toolbar_observer = new ResizeObserver(() => {
                if (this.toolbar_frame) return;
                this.toolbar_frame = requestAnimationFrame(() => {
                    this.toolbar_frame = null;
                    this.fit_toolbar();
                });
            });
            [this.$refs.top, this.$refs.top_left, this.$refs.top_info]
                .filter(Boolean)
                .forEach(el => this.toolbar_observer.observe(el));
        },

        // Shows every button, then folds them one at a time until the bar fits. It all
        // happens before the browser paints, so nothing flickers; if even the folded bar is
        // too wide, it still scrolls sideways (#226)
        async fit_toolbar() {
            const top = this.$refs.top;
            if (!top || this.fitting_toolbar) return;
            this.fitting_toolbar = true;
            try {
                this.toolbar_tucked = 0;
                await this.$nextTick();
                while (
                    top.scrollWidth > top.clientWidth &&
                    this.toolbar_tucked < this.toolbar_order.length
                ) {
                    this.toolbar_tucked++;
                    await this.$nextTick();
                }
            } finally {
                this.fitting_toolbar = false;
            }
        },
        /*** End: Top bar fit ***/

        /*** Start: AI columns (#205) ***/
        ai_columns_btn_clicked() {
            this.$bus.$emit('container-dialog:open', {
                title: `${table_display_name(this.file.name)}: AI columns`,
                props: {
                    file: this.file,
                    on_change: columns => this.ai_columns_changed(columns)
                },
                component: AiColumnDialog
            });
        },

        // Which columns are AI columns: their empty cells show why they weren't filled
        async load_ai_columns() {
            try {
                const res = await ai_column_http.list(this.file_directory_id);
                return new Set(((res && res.columns) || []).map(c => c.field));
            } catch (ex) {
                return new Set();
            }
        },

        ai_columns_changed(columns) {
            const fields = new Set(columns.map(c => c.field));
            const same =
                fields.size === this.ai_fields.size &&
                [...fields].every(f => this.ai_fields.has(f));
            this.ai_fields = fields;
            if (!same && this.grid_api && !this.edit_column_mode) {
                this.set_column_defs(
                    this.col_defs().map(c => this.ai_col_def(c))
                );
            }
        },

        // An AI column's cells use render_ai_cell; others go back to the default
        ai_col_def(col_def) {
            if (col_def.col_type === 'link' || col_def.field === 'row_num') {
                return col_def;
            }
            const def = { ...col_def };
            if (this.ai_fields.has(def.field)) {
                def.cellRenderer = this.render_ai_cell;
                def.cellClass = 'ai-cell';
            } else if (def.cellRenderer === this.render_ai_cell) {
                delete def.cellRenderer;
                delete def.cellClass;
            }
            return def;
        },

        // An AI cell: its value, or a note when the AI stopped before filling it
        render_ai_cell(params) {
            const cell = document.createElement('span');
            const value = params.value;
            const field = params.colDef.field;
            const state =
                params.data && params.data._ai && params.data._ai[field];
            const empty = value === null || value === undefined || value === '';
            if (empty && state && state.s) {
                cell.className = 'ai-cell-note';
                cell.textContent =
                    AI_CELL_NOTES[state.s] || 'Not filled by the AI';
                cell.title = 'Fill the column again from More → AI columns';
            } else {
                cell.textContent = empty ? '' : String(value);
            }
            return cell;
        },

        // The AI filled some cells: show them, unless the user is in the middle of something
        ai_column_filled() {
            if (!this.grid_api || this.table_lock) return;
            if (this.add_row_mode || this.edit_column_mode) return;
            if (this.grid_api.getEditingCells().length > 0) return;
            this.refresh_clicked();
        },
        /*** End: AI columns ***/

        // Who changed what in this table (#217)
        history_btn_clicked() {
            this.$bus.$emit('container-dialog:open', {
                title: `${table_display_name(this.file.name)}: history`,
                props: {
                    file: this.file
                },
                component: AuditLog
            });
        },

        // AI on and the email verified: shows "Ask" and "Generate rows"
        async load_ai_status() {
            this.ai_available = await ai_http.enabled();
        },

        ask_btn_clicked() {
            this.$bus.$emit('container-dialog:open', {
                title: `${table_display_name(this.file.name)}: ask AI`,
                props: {
                    file: this.file,
                    // Rows the AI proposed (#234) become new rows to review, then Save
                    on_generated: rows => this.add_proposed_rows(rows),
                    // An AI edit (#204) was applied or undone: show the new values
                    on_edited: () => this.grid_api && this.refresh_clicked()
                },
                component: AskDialog
            });
        },
        /*** End: Header controls event handlers ***/

        /*** Start: Saved views (#146) ***/
        async load_views() {
            try {
                const res = await view_http.list(this.file_directory_id);
                this.views = (res && res.views) || [];
            } catch (ex) {
                this.views = [];
            }
        },

        view_command(command) {
            if (command === 'manage') {
                this.views_btn_clicked();
            } else if (command === 'grid') {
                this.select_view(null);
            } else {
                const view = this.views.find(v => v.id === command);
                if (view) this.select_view(view);
            }
        },

        views_btn_clicked() {
            this.$bus.$emit('container-dialog:open', {
                title: `${table_display_name(this.file.name)}: views`,
                props: {
                    file: this.file,
                    state: () => this.grid_state(),
                    current_id: this.current_view ? this.current_view.id : null,
                    on_select: view => this.select_view(view),
                    on_change: views => this.views_changed(views)
                },
                component: ViewsDialog
            });
        },

        views_changed(views) {
            this.views = views.slice();
            if (this.current_view) {
                const current = this.views.find(
                    v => v.id === this.current_view.id
                );
                if (!current) this.select_view(null);
                else this.current_view = current;
            }
        },

        // Shows a view (null: the plain grid). The grid takes the view's filters, sort and
        // hidden columns, whatever its type, so switching back to the grid keeps them.
        select_view(view) {
            if (this.add_row_mode || this.edit_column_mode) return;
            this.current_view = view;
            this.view_version++;
            this.apply_view_to_grid(view);
        },

        grid_column_by_field(field) {
            return this.grid_api
                .getAllGridColumns()
                .find(c => c.getColDef().field === field);
        },

        apply_view_to_grid(view) {
            if (!this.grid_api) return;
            this.hidden_fields = new Set((view && view.hidden_fields) || []);
            this.apply_hidden_columns();

            // The same model the filter row (grid-filter.js) makes
            const model = {};
            ((view && view.filters) || []).forEach(f => {
                const col = this.grid_column_by_field(f.field);
                if (!col) return;
                model[col.getColId()] = {
                    filterType: 'text',
                    type: 'contains',
                    filter: JSON.stringify({
                        col_type: col_meta(col.getColDef()).col_type,
                        filter_type: f.type,
                        filter_value: f.value
                    })
                };
            });
            this.grid_api.setFilterModel(model);

            const sort = view && view.sort;
            const col = sort ? this.grid_column_by_field(sort.field) : null;
            this.grid_api.applyColumnState({
                state: col ? [{ colId: col.getColId(), sort: sort.dir }] : [],
                defaultState: { sort: null }
            });
        },

        apply_hidden_columns() {
            if (!this.grid_api) return;
            const cols = this.grid_api
                .getAllGridColumns()
                .filter(c => c.getColDef().field !== 'row_num');
            const hidden = c => this.hidden_fields.has(c.getColDef().field);
            const show = cols.filter(c => !hidden(c));
            const hide = cols.filter(hidden);
            if (show.length > 0) this.grid_api.setColumnsVisible(show, true);
            if (hide.length > 0) this.grid_api.setColumnsVisible(hide, false);
        },

        // After the columns were edited or reloaded: hide the view's hidden columns again
        restore_view_columns() {
            this.hidden_fields = new Set(
                (this.current_view && this.current_view.hidden_fields) || []
            );
            this.apply_hidden_columns();
        },

        // The grid's filters, sort and hidden columns, as a view stores them
        grid_state() {
            const filters = [];
            const model = this.grid_api.getFilterModel() || {};
            Object.keys(model).forEach(col_id => {
                const col = this.grid_api.getColumn(col_id);
                const field = col && col.getColDef().field;
                if (!field || field === 'row_num') return;
                let f;
                try {
                    f = JSON.parse(model[col_id].filter);
                } catch (ex) {
                    return;
                }
                if (
                    !f ||
                    f.filter_value === null ||
                    f.filter_value === undefined
                )
                    return;
                if (String(f.filter_value).trim() === '') return;
                filters.push({
                    field,
                    type: f.filter_type,
                    value: String(f.filter_value)
                });
            });

            let sort = null;
            const sorted = this.grid_api.getColumnState().find(s => s.sort);
            if (sorted) {
                const col = this.grid_api.getColumn(sorted.colId);
                const field = col && col.getColDef().field;
                if (field) sort = { field, dir: sorted.sort };
            }

            const hidden_fields = this.grid_api
                .getAllGridColumns()
                .filter(c => !c.isVisible())
                .map(c => c.getColDef().field)
                .filter(f => f && f !== 'row_num');
            return { filters, sort, hidden_fields };
        },

        // A card moved on the board: the grid's rows are stale
        view_row_saved() {
            this.grid_api.refreshInfiniteCache();
            this.show_top_bar_success('Saved', 1000);
        },
        /*** End: Saved views ***/

        /*** Start: Add Mode ***/
        async set_add_row_mode() {
            this.set_column_defs(
                this.col_defs().map(c => Object.assign({}, c))
            );
            this.show_delete_rows = false;
            this.set_datasource(this.add_row_mode_get_rows);
        },

        // Add-row mode shows the table's last few rows (covered) above the new ones
        async load_add_row_mode_data() {
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
            this.add_link_labels(res);
            this.add_data = res.data;
        },

        async add_row_mode_get_rows(params) {
            if (!this.add_row_mode) {
                await this.load_add_row_mode_data();
            }
            // One blank row per click, not per block of rows the grid asks for: with generated
            // rows (#148) there can be more new rows than one block
            if (params.startRow > 0)
                return this.generated_rows_get_rows(params);
            let data = mgr.add_new_row(
                this.add_data,
                this.new_rows,
                this.total_rows,
                this.file_directory_id
            );
            params.successCallback(
                data.slice(params.startRow, params.endRow),
                data.length
            );
            this.hide_top_bar_msg();
        },

        /*** Start: Generated rows (#148, asked for in Ask AI, #234) ***/
        /**
         * Rows proposed in Ask AI, shown as new rows to review. Answers null when they're shown,
         * or why they can't be yet, so the dialog stays open with its rows (already paid for).
         * A kanban or chart view is left for the plain grid, where the rows show.
         * @param {any[]} rows
         * @returns {string | null}
         */
        add_proposed_rows(rows) {
            if (!this.grid_api)
                return 'The table is still loading. Try again in a moment.';
            if (this.table_lock || this.processing) {
                return 'The table is updating. Try again in a moment.';
            }
            if (this.edit_column_mode) {
                return 'Save or cancel your column changes first, then add the rows.';
            }
            if (this.other_view) this.select_view(null);
            this.preview_generated_rows(rows);
            return null;
        },

        // The generated rows become new rows of add-row mode: the user can edit or delete
        // them, then Save inserts them (row limit, locks, webhooks) or Cancel drops them.
        async preview_generated_rows(rows) {
            if (!this.grid_api || this.edit_column_mode) return;
            const last = this.new_rows[this.new_rows.length - 1];
            let index = last ? last.new_row_index + 1 : 0;
            // An untouched blank row of add-row mode isn't kept
            this.new_rows = this.new_rows.filter(r =>
                Object.keys(r).some(
                    k =>
                        k !== 'new_row_index' &&
                        k !== 'file_directory_id' &&
                        k !== 'row_num'
                )
            );
            rows.forEach(r =>
                this.new_rows.push({
                    ...r,
                    new_row_index: index++,
                    file_directory_id: this.file_directory_id
                })
            );
            if (!this.add_row_mode) {
                this.set_column_defs(
                    this.col_defs().map(c => Object.assign({}, c))
                );
                this.show_delete_rows = false;
            }
            this.set_datasource(this.generated_rows_get_rows);
            this.toast.info(
                `${rows.length} generated rows. Edit or delete any, then Save to add them.`,
                5000
            );
        },

        // Like add_row_mode_get_rows, without a blank row, a block at a time
        async generated_rows_get_rows(params) {
            if (!this.add_row_mode) {
                await this.load_add_row_mode_data();
            }
            const data = mgr.number_new_rows(
                this.add_data.concat(this.new_rows),
                this.total_rows
            );
            params.successCallback(
                data.slice(params.startRow, params.endRow),
                data.length
            );
            this.hide_top_bar_msg();
        },
        /*** End: Generated rows ***/

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
                .map(c => from_grid(c.getColDef()));
        },

        set_column_defs(col_defs) {
            this.grid_api.setGridOption('columnDefs', col_defs.map(to_grid));
        },

        set_datasource(get_rows) {
            this.grid_api.setGridOption('datasource', { getRows: get_rows });
        }
        /*** End: Grid Helpers ***/
    }
};
