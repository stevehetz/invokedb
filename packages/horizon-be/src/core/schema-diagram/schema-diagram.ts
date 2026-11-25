/**
 * Schema diagram (#208): the account's tables as cards with their columns (name and type), the
 * link columns between them (#147) as arrows, and suggested links (a column named like another
 * table's id, e.g. "Customer Id" next to a "customers" table) as dashed arrows. Everything here
 * is pure: the service hands in the tables and their stored columns, and the frontend draws the
 * result as SVG in the coordinates computed here.
 */

/** A table as read from file_directory, with its stored column documents. */
export interface SchemaTableInput {
    id: number;
    name: string;
    columns: any[];
}

export interface SchemaColumn {
    field: string;
    name: string;
    type: string;
    /** The table a link column points to */
    link_table_id?: number;
}

export interface SchemaTable {
    id: number;
    name: string;
    /** The columns drawn on the card, in the table's order */
    columns: SchemaColumn[];
    /** How many columns the card leaves out (shown as "+N more") */
    hidden_columns: number;
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface SchemaEdge {
    from_table_id: number;
    from_field: string;
    to_table_id: number;
    /** A suggestion from the column's name, not a link column */
    suggested: boolean;
    /** Start (on the column's row) and end (on the linked table's header) */
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    from_side: 'left' | 'right';
    to_side: 'left' | 'right';
}

export interface SchemaDiagram {
    tables: SchemaTable[];
    links: SchemaEdge[];
    suggestions: SchemaEdge[];
    width: number;
    height: number;
}

// The card geometry, in SVG units; the frontend draws with the same numbers
export const CARD_WIDTH = 220;
export const HEADER_HEIGHT = 32;
export const ROW_HEIGHT = 22;
export const CARD_PADDING = 6;
export const GAP_X = 90;
export const GAP_Y = 50;
export const MARGIN = 20;
/** At most this many columns on a card (link and suggested columns are always drawn). */
export const MAX_COLUMNS_SHOWN = 12;
/** At most this many cards side by side. */
export const MAX_GRID_COLUMNS = 5;

/** Lowercase letters and digits only: "Customer_ID" → "customerid". */
export function normalize_name(name: string): string {
    return String(name || '')
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '');
}

/** The forms of a table name a column can refer to it by: as is and singular. */
export function table_name_forms(name: string): string[] {
    const n = normalize_name(name);
    if (!n) return [];
    const forms = [n];
    if (n.endsWith('ies') && n.length > 3) forms.push(n.slice(0, -3) + 'y');
    else if (/(ses|xes|ches|shes)$/.test(n)) forms.push(n.slice(0, -2));
    if (n.endsWith('s') && !n.endsWith('ss') && n.length > 1) forms.push(n.slice(0, -1));
    return [...new Set(forms)];
}

/**
 * The table a column's name refers to, by "<table> id" (any case or separator, singular or
 * plural): "Customer Id", "customer_id", "CustomerID" → a table named "Customers" or
 * "customer". Not the column's own table, and not a column named just "id".
 */
export function suggested_target(
    column_name: string,
    own_table_id: number,
    tables: { id: number; name: string }[]
): number | null {
    const n = normalize_name(column_name);
    if (!n.endsWith('id')) return null;
    const prefix = n.slice(0, -2);
    if (!prefix) return null;
    const matches = tables.filter(
        t => t.id !== own_table_id && table_name_forms(t.name).includes(prefix)
    );
    // An ambiguous name ("orders" and "order") suggests nothing rather than a guess
    return matches.length === 1 ? matches[0].id : null;
}

/** A table's named columns in its order, as the diagram shows them. */
export function schema_columns(cols: any[]): SchemaColumn[] {
    return (cols || [])
        .filter(c => c && !c.deleted && typeof c.headerName === 'string' && c.headerName !== '')
        .sort((a, b) => (a.order ?? a.col_index ?? 0) - (b.order ?? b.col_index ?? 0))
        .map(c => {
            const col: SchemaColumn = {
                field: c.field,
                name: c.headerName,
                type: c.col_type || 'string'
            };
            if (c.col_type === 'link' && c.link_table_id !== undefined) {
                col.link_table_id = Number(c.link_table_id);
            }
            return col;
        });
}

/**
 * The order the cards are laid out in: tables joined by links (or suggestions) come together,
 * biggest group first, each group from its most connected table outwards; lone tables last, by
 * name.
 */
export function layout_order(
    tables: { id: number; name: string }[],
    pairs: [number, number][]
): number[] {
    const by_name = [...tables].sort(
        (a, b) => String(a.name).localeCompare(String(b.name)) || a.id - b.id
    );
    const neighbours = new Map<number, Set<number>>();
    tables.forEach(t => neighbours.set(t.id, new Set()));
    pairs.forEach(([a, b]) => {
        if (a === b || !neighbours.has(a) || !neighbours.has(b)) return;
        neighbours.get(a).add(b);
        neighbours.get(b).add(a);
    });
    const degree = (id: number) => neighbours.get(id).size;
    const rank = new Map(by_name.map((t, i) => [t.id, i]));
    const seen = new Set<number>();
    const groups: number[][] = [];
    for (const start of [...by_name].sort(
        (a, b) => degree(b.id) - degree(a.id) || rank.get(a.id) - rank.get(b.id)
    )) {
        if (seen.has(start.id)) continue;
        const group = [];
        const queue = [start.id];
        seen.add(start.id);
        while (queue.length > 0) {
            const id = queue.shift();
            group.push(id);
            [...neighbours.get(id)]
                .sort((a, b) => degree(b) - degree(a) || rank.get(a) - rank.get(b))
                .forEach(n => {
                    if (seen.has(n)) return;
                    seen.add(n);
                    queue.push(n);
                });
        }
        groups.push(group);
    }
    const linked = groups.filter(g => g.length > 1).sort((a, b) => b.length - a.length);
    const lone = groups.filter(g => g.length === 1).sort((a, b) => rank.get(a[0]) - rank.get(b[0]));
    return [...linked, ...lone].flat();
}

/** The columns a card draws: all of them, or the first ones plus every linked one. */
function shown_columns(cols: SchemaColumn[], keep: Set<string>) {
    if (cols.length <= MAX_COLUMNS_SHOWN) return { columns: cols, hidden: 0 };
    const kept = cols.filter(c => keep.has(c.field));
    let room = Math.max(0, MAX_COLUMNS_SHOWN - kept.length);
    const columns = cols.filter(c => {
        if (keep.has(c.field)) return true;
        if (room > 0) {
            room--;
            return true;
        }
        return false;
    });
    return { columns, hidden: cols.length - columns.length };
}

export function card_height(column_count: number, hidden: number): number {
    return HEADER_HEIGHT + (column_count + (hidden > 0 ? 1 : 0)) * ROW_HEIGHT + CARD_PADDING;
}

/** An arrow from a column's row on one card to the header of another (or the same) card. */
function edge(from: SchemaTable, field: string, to: SchemaTable, suggested: boolean): SchemaEdge {
    const index = from.columns.findIndex(c => c.field === field);
    const y1 = from.y + HEADER_HEIGHT + index * ROW_HEIGHT + ROW_HEIGHT / 2;
    const y2 = to.y + HEADER_HEIGHT / 2;
    let from_side: 'left' | 'right';
    let to_side: 'left' | 'right';
    if (to.x > from.x + from.width) {
        from_side = 'right';
        to_side = 'left';
    } else if (to.x + to.width < from.x) {
        from_side = 'left';
        to_side = 'right';
    } else {
        // The same column of cards (or the same card): out and back in on the right
        from_side = 'right';
        to_side = 'right';
    }
    return {
        from_table_id: from.id,
        from_field: field,
        to_table_id: to.id,
        suggested,
        x1: from_side === 'right' ? from.x + from.width : from.x,
        y1,
        x2: to_side === 'right' ? to.x + to.width : to.x,
        y2,
        from_side,
        to_side
    };
}

/** The whole diagram: cards placed on a grid, link and suggestion arrows between them. */
export function build_schema_diagram(input: SchemaTableInput[]): SchemaDiagram {
    const tables = (input || []).map(t => ({
        id: Number(t.id),
        name: String(t.name ?? ''),
        all_columns: schema_columns(t.columns)
    }));
    const ids = new Set(tables.map(t => t.id));

    // Links to a table that isn't the account's (or is gone) aren't drawn
    const links: { from: number; field: string; to: number }[] = [];
    const suggestions: { from: number; field: string; to: number }[] = [];
    for (const t of tables) {
        for (const c of t.all_columns) {
            if (c.type === 'link') {
                if (c.link_table_id !== undefined && ids.has(c.link_table_id)) {
                    links.push({ from: t.id, field: c.field, to: c.link_table_id });
                }
                continue;
            }
            const target = suggested_target(c.name, t.id, tables);
            if (target === null) continue;
            // Already linked that way: nothing to suggest
            if (t.all_columns.some(o => o.type === 'link' && o.link_table_id === target)) {
                continue;
            }
            suggestions.push({ from: t.id, field: c.field, to: target });
        }
    }

    const order = layout_order(
        tables,
        [...links, ...suggestions].map(l => [l.from, l.to] as [number, number])
    );
    const grid_columns = Math.max(
        1,
        Math.min(MAX_GRID_COLUMNS, Math.ceil(Math.sqrt(order.length)))
    );

    const keep = new Map<number, Set<string>>();
    [...links, ...suggestions].forEach(l => {
        if (!keep.has(l.from)) keep.set(l.from, new Set());
        keep.get(l.from).add(l.field);
    });

    const by_id = new Map(tables.map(t => [t.id, t]));
    const cards: SchemaTable[] = order.map(id => {
        const t = by_id.get(id);
        const { columns, hidden } = shown_columns(t.all_columns, keep.get(id) || new Set());
        return {
            id: t.id,
            name: t.name,
            columns,
            hidden_columns: hidden,
            x: 0,
            y: 0,
            width: CARD_WIDTH,
            height: card_height(columns.length, hidden)
        };
    });

    // Each grid row is as tall as its tallest card
    let y = MARGIN;
    for (let start = 0; start < cards.length; start += grid_columns) {
        const row = cards.slice(start, start + grid_columns);
        row.forEach((card, i) => {
            card.x = MARGIN + i * (CARD_WIDTH + GAP_X);
            card.y = y;
        });
        y += Math.max(...row.map(c => c.height)) + GAP_Y;
    }
    const used_columns = Math.min(grid_columns, cards.length);
    const width =
        cards.length > 0
            ? MARGIN * 2 + used_columns * CARD_WIDTH + (used_columns - 1) * GAP_X
            : MARGIN * 2;
    const height = cards.length > 0 ? y - GAP_Y + MARGIN : MARGIN * 2;

    const card_by_id = new Map(cards.map(c => [c.id, c]));
    const to_edge = (suggested: boolean) => (l: { from: number; field: string; to: number }) =>
        edge(card_by_id.get(l.from), l.field, card_by_id.get(l.to), suggested);
    return {
        tables: cards,
        links: links.map(to_edge(false)),
        suggestions: suggestions.map(to_edge(true)),
        // Room on the right for arrows that leave and come back on the right side
        width: width + GAP_X / 2,
        height
    };
}
