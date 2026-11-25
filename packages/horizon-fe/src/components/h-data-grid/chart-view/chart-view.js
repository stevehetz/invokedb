// A chart view (#146): a bar, line or pie chart of the rows counted, or a number column
// summed, per value of a column (per day for a date column), with the view's filters. Drawn as
// SVG (chart-geometry.js), with a tooltip on each mark and the numbers in a table under it.
import { defineComponent } from 'vue';
import { view_http } from '@/core/context/view/view-http';
import {
    CHART_H,
    CHART_W,
    chart_geometry,
    format_number,
    nice_ticks,
    SLICE_COLORS
} from './chart-geometry';

export { format_number, nice_ticks, SLICE_COLORS };

/** @param {any} ex @param {string} fallback */
function message_of(ex, fallback) {
    return (ex && ex.message) || fallback;
}

export default defineComponent({
    props: ['view'],

    data() {
        return {
            loading: true,
            /** @type {string | null} */
            error: null,
            /** @type {{ label: string, value: number }[]} */
            points: [],
            truncated: false,
            /** @type {number | null} */
            hover: null,
            width: CHART_W,
            height: CHART_H
        };
    },

    computed: {
        /** @returns {any} */
        chart() {
            return (this.view && this.view.chart) || {};
        },

        /** @returns {string} */
        value_label() {
            return this.chart.agg === 'sum' ? 'Sum' : 'Rows';
        },

        /** @returns {ReturnType<typeof chart_geometry>} */
        geo() {
            return chart_geometry(this.points);
        },

        /** @returns {any[]} */
        y_axis() {
            return this.geo.y_axis;
        },

        /** @returns {any[]} */
        bars() {
            return this.geo.bars;
        },

        /** @returns {any[]} */
        line_points() {
            return this.geo.line_points;
        },

        /** @returns {string} */
        line_path() {
            return this.geo.line_path;
        },

        /** @returns {any[]} */
        line_labels() {
            return this.geo.line_labels;
        },

        /** @returns {any[]} */
        slices() {
            return this.geo.slices;
        }
    },

    watch: {
        view() {
            this.load();
        }
    },

    mounted() {
        this.load();
    },

    methods: {
        async load() {
            this.loading = true;
            try {
                const res = await view_http.chart(this.view.id);
                this.points = (res && res.points) || [];
                this.truncated = !!(res && res.truncated);
                this.error = null;
            } catch (ex) {
                this.error = message_of(ex, 'Could not load the chart');
                this.points = [];
            }
            this.loading = false;
        },

        format_number
    }
});
