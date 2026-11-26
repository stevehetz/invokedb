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
            loading: null
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
                this.input_value = this.format_value(event.target.value);
                this.update_filter();
                this.loading = false;
            }, debounce_time);
        },

        format_value(value) {
            if (typeof value === 'string') {
                value = value.trim();
            }
            if (value !== '' && value !== undefined && value !== null) {
                if (this.col_type === 'date') {
                    value = format_date(
                        parse_utc_date(value),
                        'YYYY-MM-DD hh:mm:ss A',
                        true
                    );
                    if (value === 'Invalid date') {
                        value = null;
                    }
                }
            }

            return value;
        },

        update_filter() {
            let value = this.input_value;
            try {
                if (value === '' || value === undefined || value === null) {
                    value = this.input_value = null;
                } else {
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
