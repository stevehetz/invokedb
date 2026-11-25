// The geometry of a chart's SVG (#146): bars, a line's points and pie slices for a list of
// `{ label, value }` points, in a fixed viewBox. Shared by the grid's chart view and dashboard
// chart tiles (#209), which draw the same marks with their own CSS.

// Pie slices take the categorical slots in fixed order (bars and lines are one series, one hue)
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

export const CHART_W = 640;
export const CHART_H = 300;
export const CHART_PAD = { top: 16, right: 16, bottom: 56, left: 56 };

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
export function shorten(s, n) {
    return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

/**
 * Every mark of a chart of `points`, in a CHART_W × CHART_H viewBox.
 * @param {{ label: string, value: number }[]} points
 */
export function chart_geometry(points) {
    const W = CHART_W;
    const H = CHART_H;
    const PAD = CHART_PAD;
    const plot_w = W - PAD.left - PAD.right;
    const plot_h = H - PAD.top - PAD.bottom;
    const ticks = nice_ticks(Math.max(0, ...points.map(p => p.value)));
    const top = ticks[ticks.length - 1] || 1;
    /** @param {number} v */
    const y = v => PAD.top + plot_h - (v / top) * plot_h;

    const y_axis = ticks.map(t => ({
        value: t,
        label: format_number(t),
        y: y(t)
    }));

    const n = points.length || 1;
    const band = plot_w / n;
    // 2px surface gap between bars at the least
    const bar_w = Math.max(2, Math.min(48, band * 0.7, band - 2));
    const bars = points.map((p, i) => {
        const by = y(p.value);
        return {
            ...p,
            x: PAD.left + band * i + (band - bar_w) / 2,
            y: by,
            w: bar_w,
            h: Math.max(0, PAD.top + plot_h - by),
            cx: PAD.left + band * i + band / 2,
            short: shorten(p.label, Math.max(4, Math.floor(band / 7)))
        };
    });

    const line_points = points.map((p, i) => ({
        ...p,
        x:
            PAD.left +
            (points.length > 1
                ? (plot_w * i) / (points.length - 1)
                : plot_w / 2),
        y: y(p.value)
    }));
    const line_path = line_points
        .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`)
        .join(' ');
    // x labels of a line chart, thinned to fit
    const every = Math.max(1, Math.ceil(line_points.length / 8));
    const line_labels = line_points.filter((p, i) => i % every === 0);

    return {
        y_axis,
        bars,
        line_points,
        line_path,
        line_labels,
        slices: pie_slices(points)
    };
}

/** @param {{ label: string, value: number }[]} points */
function pie_slices(points) {
    const pts = points.filter(p => p.value > 0);
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
    const cy = CHART_H / 2;
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
