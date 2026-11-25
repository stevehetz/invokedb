// The drawing of a map view (#211): its points in Web Mercator, fitted to an SVG with some
// margin, and latitude and longitude lines at a round step. There's no base map (no tiles are
// fetched from anywhere), so the lines are what place the points.

export const MAP_W = 720;
export const MAP_H = 420;
const PAD = 36;
// Mercator can't show the poles
const MAX_LAT = 85;
const STEPS = [
    0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30,
    45, 90
];

const clamp = (
    /** @type {number} */ v,
    /** @type {number} */ lo,
    /** @type {number} */ hi
) => Math.min(hi, Math.max(lo, v));

/** @param {number} lat degrees @returns {number} Mercator y, in degree-like units */
function merc_y(lat) {
    const phi = (clamp(lat, -MAX_LAT, MAX_LAT) * Math.PI) / 180;
    return (Math.log(Math.tan(Math.PI / 4 + phi / 2)) * 180) / Math.PI;
}

/** @param {number} y Mercator y @returns {number} latitude */
function merc_lat(y) {
    return (
        ((2 * Math.atan(Math.exp((y * Math.PI) / 180)) - Math.PI / 2) * 180) /
        Math.PI
    );
}

/** @param {number} range @returns {number} a round step giving about five lines */
function grid_step(range) {
    return STEPS.find(s => s >= range / 5) || 90;
}

/** @param {number} v @param {number} step @param {string} pos @param {string} neg */
export function format_degrees(v, step, pos, neg) {
    const decimals = step < 1 ? Math.ceil(-Math.log10(step) - 1e-9) : 0;
    const n = Math.abs(v).toFixed(decimals);
    if (Number(n) === 0) return '0°';
    return `${n}°${v > 0 ? pos : neg}`;
}

/**
 * Where each point and grid line is drawn
 * @param {{ lat: number, lng: number }[]} points
 */
export function map_geometry(points) {
    /** @type {{ x: number, y: number, i: number }[]} */
    const dots = [];
    /** @type {{ pos: number, label: string }[]} */
    const lat_lines = [];
    /** @type {{ pos: number, label: string }[]} */
    const lng_lines = [];
    if (!points || points.length === 0) return { dots, lat_lines, lng_lines };

    const lats = points.map(p => clamp(p.lat, -MAX_LAT, MAX_LAT));
    const lngs = points.map(p => p.lng);
    // The points' box, at least a little area, with a margin
    const box = (
        /** @type {number[]} */ vs,
        /** @type {number} */ min_span
    ) => {
        const lo = Math.min(...vs);
        const hi = Math.max(...vs);
        const span = Math.max(hi - lo, min_span);
        const mid = (lo + hi) / 2;
        return [mid - span * 0.55, mid + span * 0.55];
    };
    const [lng0, lng1] = box(lngs, 0.02).map(v => clamp(v, -180, 180));
    const [lat0, lat1] = box(lats, 0.02).map(v => clamp(v, -MAX_LAT, MAX_LAT));
    const y0 = merc_y(lat0);
    const y1 = merc_y(lat1);
    const scale = Math.min(
        (MAP_W - 2 * PAD) / (lng1 - lng0),
        (MAP_H - 2 * PAD) / (y1 - y0)
    );
    const ox = (MAP_W - scale * (lng1 - lng0)) / 2;
    const oy = (MAP_H - scale * (y1 - y0)) / 2;
    const x_of = (/** @type {number} */ lng) => ox + (lng - lng0) * scale;
    const y_of = (/** @type {number} */ lat) =>
        MAP_H - oy - (merc_y(lat) - y0) * scale;

    points.forEach((p, i) => dots.push({ x: x_of(p.lng), y: y_of(p.lat), i }));

    // Lines across everything the SVG shows, not just the points' box
    const lng_min = clamp(lng0 - ox / scale, -180, 180);
    const lng_max = clamp(lng0 + (MAP_W - ox) / scale, -180, 180);
    const lat_min = clamp(merc_lat(y0 - oy / scale), -MAX_LAT, MAX_LAT);
    const lat_max = clamp(
        merc_lat(y0 + (MAP_H - oy) / scale),
        -MAX_LAT,
        MAX_LAT
    );
    const lng_step = grid_step(lng_max - lng_min);
    for (
        let v = Math.ceil(lng_min / lng_step) * lng_step;
        v <= lng_max;
        v += lng_step
    ) {
        lng_lines.push({
            pos: x_of(v),
            label: format_degrees(v, lng_step, 'E', 'W')
        });
    }
    const lat_step = grid_step(lat_max - lat_min);
    for (
        let v = Math.ceil(lat_min / lat_step) * lat_step;
        v <= lat_max;
        v += lat_step
    ) {
        lat_lines.push({
            pos: y_of(v),
            label: format_degrees(v, lat_step, 'N', 'S')
        });
    }
    return { dots, lat_lines, lng_lines };
}

/**
 * A link to the point on OpenStreetMap, opened only when the user clicks it
 * @param {number} lat @param {number} lng
 */
export function osm_link(lat, lng) {
    const la = lat.toFixed(5);
    const lo = lng.toFixed(5);
    return `https://www.openstreetmap.org/?mlat=${la}&mlon=${lo}#map=14/${la}/${lo}`;
}
