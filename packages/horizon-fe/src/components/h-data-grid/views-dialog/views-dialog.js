// A table's saved views (#146): save the grid's current filters, sort and hidden columns as a
// grid, kanban, chart, calendar or map view (#211); open, rename, update and delete views.
// Opened from the grid's top bar through `container-dialog:open` with
// `props: { file, state, current_id, on_select, on_change }`: `state()` is the grid's current
// `{ filters, sort, hidden_fields }`, `on_select(view)` shows a view, `on_change(views)` hands
// back the table's views after a change.
import { defineComponent } from 'vue';
import { bus } from '@/core/bus';
import { view_http } from '@/core/context/view/view-http';
import { table_display_name } from '../table-name';

/** @param {any} ex @param {string} fallback */
function message_of(ex, fallback) {
    return (ex && ex.message) || fallback;
}

export const VIEW_TYPE_LABELS = {
    grid: 'Grid',
    kanban: 'Kanban',
    chart: 'Chart',
    calendar: 'Calendar',
    map: 'Map'
};

export const VIEW_TYPE_ICONS = {
    grid: 'fa fa-table',
    kanban: 'fa fa-columns',
    chart: 'fa fa-chart-bar',
    calendar: 'fa fa-calendar-alt',
    map: 'fa fa-map-marker-alt'
};

export default defineComponent({
    props: ['props'],

    data() {
        return {
            /** @type {any[]} */
            views: [],
            /** @type {any[]} */
            columns: [],
            loading: true,
            /** @type {string | null} */
            error: null,
            /** @type {any} */
            draft: null,
            saving: false,
            /** @type {string | null} */
            renaming: null,
            rename_value: '',
            /** @type {string | null} */
            updated: null,
            type_labels: VIEW_TYPE_LABELS,
            type_icons: VIEW_TYPE_ICONS
        };
    },

    computed: {
        /**
         * The table's name as the dialog's title shows it (no `.g`)
         * @returns {string}
         */
        table_name() {
            return table_display_name(this.props.file.name);
        },

        /** @returns {any} */
        state() {
            const s = this.props.state ? this.props.state() : null;
            return s || { filters: [], sort: null, hidden_fields: [] };
        },

        /** @returns {string} */
        state_summary() {
            return this.summary(this.state);
        },

        /** @returns {any[]} */
        group_columns() {
            return this.columns.filter(c =>
                ['string', 'number'].includes(c.type)
            );
        },

        /** @returns {any[]} */
        chart_columns() {
            return this.columns.filter(c =>
                ['string', 'number', 'date'].includes(c.type)
            );
        },

        /** @returns {any[]} */
        number_columns() {
            return this.columns.filter(c => c.type === 'number');
        },

        /** @returns {any[]} */
        date_columns() {
            return this.columns.filter(c => c.type === 'date');
        },

        /** @returns {boolean} */
        can_save() {
            const d = this.draft;
            if (!d || this.saving || d.name.trim() === '') return false;
            if (d.type === 'kanban') return !!d.group_field;
            if (d.type === 'chart') {
                return (
                    !!d.chart_field && (d.agg === 'count' || !!d.value_field)
                );
            }
            if (d.type === 'calendar') return !!d.date_field;
            if (d.type === 'map') {
                return (
                    !!d.lat_field &&
                    !!d.lng_field &&
                    d.lat_field !== d.lng_field
                );
            }
            return true;
        }
    },

    async mounted() {
        await this.load();
    },

    methods: {
        async load() {
            try {
                const res = await view_http.list(this.props.file.id);
                this.views = (res && res.views) || [];
                this.columns = (res && res.columns) || [];
                this.error = null;
            } catch (ex) {
                this.error = message_of(ex, 'Could not load the views');
            }
            this.loading = false;
        },

        changed() {
            if (this.props.on_change) this.props.on_change(this.views);
        },

        /** @param {any} s `{ filters, sort, hidden_fields }` */
        summary(s) {
            const parts = [];
            const n = (s.filters || []).length;
            parts.push(n === 1 ? '1 filter' : `${n} filters`);
            if (s.sort) {
                const name =
                    s.sort.field === 'row_num'
                        ? 'Row'
                        : this.column_name(s.sort.field);
                parts.push(`sorted by ${name} (${s.sort.dir})`);
            } else {
                parts.push('no sort');
            }
            const h = (s.hidden_fields || []).length;
            parts.push(h === 1 ? '1 hidden column' : `${h} hidden columns`);
            return parts.join(', ');
        },

        /** @param {string} field */
        column_name(field) {
            const c = this.columns.find(col => col.field === field);
            return c ? c.name : field;
        },

        new_view() {
            const group = this.group_columns[0];
            const chart = this.chart_columns[0];
            const num = this.number_columns[0];
            const date = this.date_columns[0];
            // Columns named like latitude and longitude, else the first two number columns
            /** @param {RegExp} re @param {number} i */
            const coord = (re, i) => {
                const c =
                    this.number_columns.find(col => re.test(col.name)) ||
                    this.number_columns[i];
                return c ? c.field : null;
            };
            this.draft = {
                name: '',
                type: 'grid',
                group_field: group ? group.field : null,
                kind: 'bar',
                chart_field: chart ? chart.field : null,
                agg: 'count',
                value_field: num ? num.field : null,
                date_field: date ? date.field : null,
                title_field: group ? group.field : null,
                lat_field: coord(/^lat/i, 0),
                lng_field: coord(/^(lng|lon)/i, 1),
                label_field: group ? group.field : null
            };
        },

        cancel() {
            this.draft = null;
        },

        async save() {
            if (!this.can_save) return;
            const d = this.draft;
            const body = {
                file_id: this.props.file.id,
                name: d.name.trim(),
                type: d.type,
                filters: this.state.filters,
                sort: this.state.sort,
                hidden_fields: this.state.hidden_fields
            };
            if (d.type === 'kanban')
                body.kanban = { group_field: d.group_field };
            if (d.type === 'chart') {
                body.chart = {
                    kind: d.kind,
                    group_field: d.chart_field,
                    agg: d.agg,
                    value_field: d.agg === 'sum' ? d.value_field : null
                };
            }
            if (d.type === 'calendar') {
                body.calendar = {
                    date_field: d.date_field,
                    title_field: d.title_field || null
                };
            }
            if (d.type === 'map') {
                body.map = {
                    lat_field: d.lat_field,
                    lng_field: d.lng_field,
                    label_field: d.label_field || null
                };
            }
            this.saving = true;
            try {
                const view = await view_http.create(body);
                this.views.push(view);
                this.changed();
                this.draft = null;
                this.open(view);
            } catch (ex) {
                bus.$emit(
                    'notify:error',
                    message_of(ex, 'Could not save the view')
                );
            }
            this.saving = false;
        },

        /** @param {any} view */
        open(view) {
            if (this.props.on_select) this.props.on_select(view);
            bus.$emit('container-dialog:close');
        },

        /** @param {any} view */
        start_rename(view) {
            this.renaming = view.id;
            this.rename_value = view.name;
        },

        /** @param {any} view */
        async rename(view) {
            const name = this.rename_value.trim();
            if (!name || name === view.name) {
                this.renaming = null;
                return;
            }
            try {
                const res = await view_http.update(view.id, { name });
                Object.assign(view, res);
                this.renaming = null;
                this.changed();
            } catch (ex) {
                bus.$emit(
                    'notify:error',
                    message_of(ex, 'Could not rename the view')
                );
            }
        },

        // Saves the grid's current filters, sort and hidden columns into the view
        /** @param {any} view */
        async update_filters(view) {
            try {
                const res = await view_http.update(view.id, {
                    filters: this.state.filters,
                    sort: this.state.sort,
                    hidden_fields: this.state.hidden_fields
                });
                Object.assign(view, res);
                this.updated = view.id;
                this.changed();
            } catch (ex) {
                bus.$emit(
                    'notify:error',
                    message_of(ex, 'Could not update the view')
                );
            }
        },

        /** @param {any} view */
        remove(view) {
            bus.$emit('confirm-dialog:open', {
                title: 'Delete view',
                message: `Delete the view "${view.name}"? The table's rows stay as they are.`,
                callback: async () => {
                    try {
                        await view_http.remove(view.id);
                        this.views = this.views.filter(v => v.id !== view.id);
                        this.changed();
                    } catch (ex) {
                        bus.$emit(
                            'notify:error',
                            message_of(ex, 'Could not delete the view')
                        );
                    }
                }
            });
        },

        /** @param {any} view */
        describe(view) {
            if (view.type === 'kanban' && view.kanban) {
                return `grouped by ${this.column_name(view.kanban.group_field)}`;
            }
            if (view.type === 'chart' && view.chart) {
                const c = view.chart;
                const what =
                    c.agg === 'sum'
                        ? `sum of ${this.column_name(c.value_field)}`
                        : 'row count';
                return `${c.kind} chart of ${what} by ${this.column_name(c.group_field)}`;
            }
            if (view.type === 'calendar' && view.calendar) {
                return `calendar by ${this.column_name(view.calendar.date_field)}`;
            }
            if (view.type === 'map' && view.map) {
                const m = view.map;
                return `map of ${this.column_name(m.lat_field)}, ${this.column_name(m.lng_field)}`;
            }
            return '';
        }
    }
});
