// A chart view (#146): a bar, line or pie chart of the rows counted, or a number column
// summed, per value of a column (per day for a date column), with the view's filters. Drawn as
// SVG, with a tooltip on each mark and the numbers in a table under it.
import { defineComponent } from 'vue';
import { view_http } from '@/core/context/view/view-http';

// Pie slices take the categorical slots in fixed order (bars and lines are one series, one
// hue: stylesheet.scss)
export const SLICE_COLORS = [
    '#257de0',
    '#f47230',
    '#00b894',
    '#f2a600',
    '#ee7fac',
    '#008a17',
    '#6a4ce2',
    '#ec4647'
];
// Slices past the palette fold into one "Other" slice
const OTHER_COLOR = '#9c9c9c';

const W = 640;
const H = 300;
const PAD = { top: 16, right: 16, bottom: 56, left: 56 };

/** @param {any} ex @param {string} fallback */
function message_of(ex, fallback) {
    return (ex && ex.message) || fallback;
}

/** @param {number} n */
export function format_number(n) {
    return Number.isInteger(n)
        ? n.toLocaleString()
        : n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

/** Round ticks from 0 to just above `max`. @param {number} max */
export function nice_ticks(max) {
    if (!(max > 0)) return [0, 1];
    const raw = max / 4;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const step =
        [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= raw) || raw;
    const ticks = [];
    for (let v = 0; v < max + step; v += step) {
        ticks.push(Number(v.toPrecision(12)));
        if (v >= max) break;
    }
    return ticks;
}

/** @param {string} s @param {number} n */
function shorten(s, n) {
    return s.length > n ? s.slice(0, n - 1) + '…' : s;
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
            width: W,
            height: H
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

        /** @returns {number[]} */
        ticks() {
            const max = Math.max(0, ...this.points.map(p => p.value));
            return nice_ticks(max);
        },

        /** @returns {number} */
        top() {
            return this.ticks[this.ticks.length - 1] || 1;
        },

        /** @returns {number} */
        plot_w() {
            return W - PAD.left - PAD.right;
        },

        /** @returns {number} */
        plot_h() {
            return H - PAD.top - PAD.bottom;
        },

        /** @returns {any[]} */
        y_axis() {
            return this.ticks.map(t => ({
                value: t,
                label: format_number(t),
                y: this.y(t)
            }));
        },

        /** @returns {any[]} */
        bars() {
            const n = this.points.length || 1;
            const band = this.plot_w / n;
            // 2px surface gap between bars at the least
            const w = Math.max(2, Math.min(48, band * 0.7, band - 2));
            return this.points.map((p, i) => {
                const x = PAD.left + band * i + (band - w) / 2;
                const y = this.y(p.value);
                return {
                    ...p,
                    x,
                    y,
                    w,
                    h: Math.max(0, PAD.top + this.plot_h - y),
                    cx: PAD.left + band * i + band / 2,
                    short: shorten(p.label, Math.max(4, Math.floor(band / 7)))
                };
            });
        },

        /** @returns {any[]} */
        line_points() {
            const n = this.points.length;
            return this.points.map((p, i) => ({
                ...p,
                x:
                    PAD.left +
                    (n > 1 ? (this.plot_w * i) / (n - 1) : this.plot_w / 2),
                y: this.y(p.value)
            }));
        },

        /** @returns {string} */
        line_path() {
            return this.line_points
                .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`)
                .join(' ');
        },

        /** @returns {any[]} x labels of a line chart, thinned to fit */
        line_labels() {
            const every = Math.max(1, Math.ceil(this.line_points.length / 8));
            return this.line_points.filter((p, i) => i % every === 0);
        },

        /** @returns {any[]} */
        slices() {
            const pts = this.points.filter(p => p.value > 0);
            let shown = pts;
            if (pts.length > SLICE_COLORS.length) {
                shown = pts.slice(0, SLICE_COLORS.length - 1);
                const rest = pts
                    .slice(SLICE_COLORS.length - 1)
                    .reduce((s, p) => s + p.value, 0);
                shown = shown.concat([{ label: 'Other', value: rest }]);
            }
            const total = shown.reduce((s, p) => s + p.value, 0);
            const cx = 150;
            const cy = H / 2;
            const r = 120;
            let angle = -Math.PI / 2;
            return shown.map((p, i) => {
                const share = total > 0 ? p.value / total : 0;
                const a0 = angle;
                const a1 = angle + share * Math.PI * 2;
                angle = a1;
                const color =
                    p.label === 'Other' && i === SLICE_COLORS.length - 1
                        ? OTHER_COLOR
                        : SLICE_COLORS[i];
                let path;
                if (share >= 0.9999) {
                    path = `M${cx - r},${cy} a${r},${r} 0 1,0 ${r * 2},0 a${r},${r} 0 1,0 ${-r * 2},0`;
                } else {
                    const large = a1 - a0 > Math.PI ? 1 : 0;
                    const x0 = cx + r * Math.cos(a0);
                    const y0 = cy + r * Math.sin(a0);
                    const x1 = cx + r * Math.cos(a1);
                    const y1 = cy + r * Math.sin(a1);
                    path = `M${cx},${cy} L${x0},${y0} A${r},${r} 0 ${large},1 ${x1},${y1} Z`;
                }
                return {
                    ...p,
                    path,
                    color,
                    percent: Math.round(share * 1000) / 10
                };
            });
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

        /** @param {number} v */
        y(v) {
            return PAD.top + this.plot_h - (v / this.top) * this.plot_h;
        },

        format_number
    }
});
