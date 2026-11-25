// A dashboard's tiles (#209), as the server reads them (`GET /dashboard/:id/data`, or the
// share link's `GET /public/dashboard/:token`): charts (SVG, chart-geometry.js), tables and
// stats, two to a row unless a tile is wide. Only draws; the page around it loads the data.
// Used in the app and on the share link's page, which is outside both areas' shells, so the
// CSS is scoped and self-contained.
import { defineComponent } from 'vue';
import {
    CHART_H,
    CHART_W,
    chart_geometry,
    format_number
} from '@/components/h-data-grid/chart-view/chart-geometry';

const AGG_LABELS = {
    count: 'Rows',
    sum: 'Sum of',
    avg: 'Average of',
    min: 'Lowest',
    max: 'Highest'
};

/** A stat tile's caption. @param {any} data */
export function stat_caption(data) {
    if (!data) return '';
    if (data.agg === 'count' || !data.column) return 'Rows';
    return `${AGG_LABELS[data.agg] || data.agg} ${data.column}`;
}

/** A cell of a table tile. @param {unknown} v */
export function cell_text(v) {
    if (v === null || v === undefined) return '';
    if (typeof v === 'number') return format_number(v);
    if (typeof v === 'boolean') return v ? 'Yes' : 'No';
    if (typeof v === 'object') return JSON.stringify(v);
    return String(v);
}

export default defineComponent({
    props: {
        tiles: {
            type: /** @type {import('vue').PropType<any[]>} */ (Array),
            default: () => []
        },
        // Shows each tile's edit and remove buttons (the owner's page)
        editable: { type: Boolean, default: false }
    },

    emits: ['edit', 'remove'],

    data() {
        return {
            width: CHART_W,
            height: CHART_H,
            /** @type {Record<string, number | null>} the mark under the pointer, per tile */
            hover: {}
        };
    },

    computed: {
        /** @returns {Record<string, ReturnType<typeof chart_geometry>>} */
        charts() {
            /** @type {Record<string, ReturnType<typeof chart_geometry>>} */
            const out = {};
            this.tiles.forEach(t => {
                if (t.type === 'chart' && t.data && t.data.points) {
                    out[t.id] = chart_geometry(t.data.points);
                }
            });
            return out;
        }
    },

    methods: {
        /** @param {string} id @param {number | null} i */
        set_hover(id, i) {
            this.hover = { ...this.hover, [id]: i };
        },

        /** @param {any} tile @param {number} i */
        dim(tile, i) {
            const h = this.hover[tile.id];
            return h !== null && h !== undefined && h !== i;
        },

        /** @param {any} tile */
        readout(tile) {
            const h = this.hover[tile.id];
            const p = h !== null && h !== undefined && tile.data.points[h];
            if (p) return `${p.label}: ${format_number(p.value)}`;
            return tile.data.agg === 'sum' ? 'Sum per value' : 'Rows per value';
        },

        /** @param {string} label @param {number} n */
        clip(label, n) {
            return label.length > n ? label.slice(0, n - 1) + '…' : label;
        },

        stat_caption,
        cell_text,
        format_number
    }
});
