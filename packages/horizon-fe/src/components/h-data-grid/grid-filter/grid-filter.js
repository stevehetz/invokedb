import { parse_utc_date, format_date } from '@/core/date';
import { col_meta } from '../col-def';

const string_filter_types = {
    equals: '=',
    contains: '≈'
};

const number_filter_types = {
    equals: '=',
    lessThan: '<',
    lessThanOrEqual: '<=',
    greaterThan: '>',
    greaterThanOrEqual: '>='
};

export default {
    props: ['params'],

    data() {
        return {
            input_value: null,
            col_type: null,
            filter_types: {},
            selected_type: null,
            timeout: null,
            loading: null,
            // The typed value can't be a filter for this column (filter_value)
            invalid: false,
            invalid_message: null
        };
    },

    mounted() {
        this.filter_type_menu_handlers();
        this.col_type = col_meta(this.params.column.colDef).col_type;
        if (this.col_type === 'number' || this.col_type === 'date') {
            this.filter_types = number_filter_types;
            this.selected_type = 'equals';
        } else {
            this.filter_types = string_filter_types;
            this.selected_type = 'contains';
        }
    },

    methods: {
        valueChanged(event) {
            this.input_value = event.target.value;
            const debounce_time = this.col_type === 'date' ? 1000 : 500;
            this.loading = true;
            clearTimeout(this.timeout);
            this.timeout = setTimeout(() => {
                this.input_value = event.target.value;
                this.update_filter();
                this.loading = false;
            }, debounce_time);
        },

        // The value to filter on, or null for none. A number column's value that isn't a
        // number, or a date that doesn't parse, filters nothing and marks the input invalid
        // (#355): the backend refuses them, which once left the grid's page unloaded.
        filter_value(value) {
            if (typeof value === 'string') {
                value = value.trim();
            }
            this.invalid = false;
            if (value === '' || value === undefined || value === null) {
                return null;
            }
            if (this.col_type === 'number') {
                const n = typeof value === 'number' ? value : Number(value);
                if (!Number.isFinite(n)) {
                    this.invalid = true;
                    this.invalid_message =
                        'Not a number: this filter is ignored';
                    return null;
                }
                return n;
            }
            if (this.col_type === 'date') {
                const date = format_date(
                    parse_utc_date(value),
                    'YYYY-MM-DD hh:mm:ss A',
                    true
                );
                if (!date || date === 'Invalid date') {
                    this.invalid = true;
                    this.invalid_message = 'Not a date: this filter is ignored';
                    return null;
                }
                // The input shows the date as it's matched
                this.input_value = date;
                return date;
            }
            return value;
        },

        update_filter() {
            try {
                let value = this.filter_value(this.input_value);
                if (value !== null) {
                    value = JSON.stringify({
                        col_type: col_meta(this.params.column.colDef).col_type,
                        filter_type: this.selected_type,
                        filter_value: value
                    });
                }
                this.params.parentFilterInstance(instance => {
                    // The JSON value carries the real filter type; the text filter just needs a valid one
                    instance.onFloatingFilterChanged('contains', value);
                });
            } catch (ex) {
                console.log(ex);
            }
        },

        change_type(value) {
            this.selected_type = value;
            if (
                this.input_value !== undefined &&
                this.input_value !== null &&
                this.input_value !== ''
            ) {
                this.update_filter();
            }
        },

        filter_type_menu_handlers() {
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

        // The filter set from outside this input, such as by a saved view (#146): show its value
        // and type. The model's `filter` is the JSON update_filter() writes.
        onParentModelChanged(parentModel) {
            // Mid-typing, the input already shows what's coming
            if (this.loading) return;
            this.invalid = false;
            if (!parentModel || !parentModel.filter) {
                this.input_value = null;
                return;
            }
            try {
                const f = JSON.parse(parentModel.filter);
                const col_type = col_meta(this.params.column.colDef).col_type;
                const types =
                    col_type === 'number' || col_type === 'date'
                        ? number_filter_types
                        : string_filter_types;
                if (types[f.filter_type]) this.selected_type = f.filter_type;
                this.input_value = f.filter_value;
            } catch (ex) {
                console.log(ex);
            }
        }
    }
};
