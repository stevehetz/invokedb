// The admin's Errors page (#212) shows a frontend error's stack in the source files, not the
// minified bundle: the build writes hidden source maps next to the assets (vite.config.js,
// `build.sourcemap: 'hidden'`), and the page reads `<asset>.map` for each frame in an asset of
// this site. A small decoder of the maps' `mappings` (base64 VLQ, source map v3), so no library.

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_VALUE = new Map([...B64].map((c, i) => [c, i]));

/**
 * One segment's numbers.
 * @param {string} segment
 * @returns {number[]}
 */
export function decode_vlq(segment) {
    /** @type {number[]} */
    const out = [];
    let value = 0;
    let shift = 0;
    for (const c of segment) {
        const digit = B64_VALUE.get(c);
        if (digit === undefined) throw new Error(`Bad VLQ character ${c}`);
        value += (digit & 31) << shift;
        if (digit & 32) {
            shift += 5;
        } else {
            out.push(value & 1 ? -(value >>> 1) : value >>> 1);
            value = 0;
            shift = 0;
        }
    }
    return out;
}

/**
 * @typedef {{ col: number, source: number, line: number, source_col: number, name: number | null }} Segment
 */

/**
 * Each generated line's segments, in column order, with absolute values (0-based).
 * @param {string} mappings
 * @returns {Segment[][]}
 */
export function parse_mappings(mappings) {
    /** @type {Segment[][]} */
    const lines = [];
    let source = 0;
    let line = 0;
    let source_col = 0;
    let name = 0;
    for (const text of mappings.split(';')) {
        /** @type {Segment[]} */
        const segments = [];
        let col = 0;
        for (const seg of text.split(',')) {
            if (!seg) continue;
            const v = decode_vlq(seg);
            col += v[0];
            if (v.length < 4) continue;
            source += v[1];
            line += v[2];
            source_col += v[3];
            let n = null;
            if (v.length >= 5) {
                name += v[4];
                n = name;
            }
            segments.push({ col, source, line, source_col, name: n });
        }
        lines.push(segments);
    }
    return lines;
}

/** @param {string} source */
function clean_source(source) {
    // "../../src/x.js?vue&type=script&src=true&lang.js" -> "src/x.js"
    return source
        .replace(/^(\.\.\/|\.\/)+/, '')
        .replace(/^webpack:\/\/\//, '')
        .replace(/\?.*$/, '');
}

/**
 * Where a generated position (1-based line and column, as in a stack) came from.
 * @param {{ sources: string[], names?: string[], lines: Segment[][] }} map
 * @param {number} line
 * @param {number} column
 * @returns {{ source: string, line: number, column: number, name: string | null } | null}
 */
export function original_position(map, line, column) {
    const segments = map.lines[line - 1];
    if (!segments || segments.length === 0) return null;
    const col = column - 1;
    // The last segment starting at or before the column
    let lo = 0;
    let hi = segments.length - 1;
    let found = -1;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (segments[mid].col <= col) {
            found = mid;
            lo = mid + 1;
        } else {
            hi = mid - 1;
        }
    }
    if (found < 0) return null;
    const s = segments[found];
    const source = map.sources[s.source];
    if (typeof source !== 'string') return null;
    return {
        source: clean_source(source),
        line: s.line + 1,
        column: s.source_col + 1,
        name:
            s.name !== null && map.names && map.names[s.name]
                ? map.names[s.name]
                : null
    };
}

// A frame's location: "https://site/assets/x-hash.js:1:234"
const LOCATION = /(https?:\/\/[^\s()@]+?\.m?js):(\d+):(\d+)/;

/**
 * The stack with each frame in one of this site's assets mapped to its source. `load_map`
 * answers a raw source map for a script URL (or null); each map is read once.
 * @param {string} stack
 * @param {string} origin this site's origin: only its /assets/ are read
 * @param {(url: string) => Promise<any>} load_map
 * @returns {Promise<{ text: string, mapped: number }>}
 */
export async function resolve_stack(stack, origin, load_map) {
    /** @type {Map<string, Promise<any>>} */
    const maps = new Map();
    const get_map = url => {
        if (!maps.has(url)) {
            maps.set(
                url,
                load_map(url)
                    .then(raw =>
                        raw && typeof raw.mappings === 'string'
                            ? {
                                  sources: raw.sources || [],
                                  names: raw.names || [],
                                  lines: parse_mappings(raw.mappings)
                              }
                            : null
                    )
                    .catch(() => null)
            );
        }
        return maps.get(url);
    };
    let mapped = 0;
    const out = [];
    for (const line of stack.split('\n')) {
        const m = line.match(LOCATION);
        if (!m || !m[1].startsWith(`${origin}/assets/`)) {
            out.push(line);
            continue;
        }
        const map = await get_map(m[1]);
        const pos = map && original_position(map, Number(m[2]), Number(m[3]));
        if (!pos) {
            out.push(line);
            continue;
        }
        mapped++;
        const where = `${pos.source}:${pos.line}:${pos.column}`;
        out.push(`    at ${pos.name ? `${pos.name} (${where})` : where}`);
    }
    return { text: out.join('\n'), mapped };
}
