/**
 * Schema diagram (#208): the account's tables as cards with their columns (name and type), the
 * link columns between them (#147) as arrows, and suggested links (a column named like another
 * table's id, e.g. "Customer Id" next to a "customers" table) as dashed arrows. Everything here
 * is pure: the service hands in the tables and their stored columns, and the frontend draws the
 * result as SVG in the coordinates computed here.
 *
 * Folders (#376): the diagram can show one folder (with its subfolders) or the unfiled tables,
 * plus the tables one hop away from them through a link or a suggestion ("outside" cards, laid
 * out after the folder's own), and can leave out every card with no arrow ("linked only").
 */

/** A table as read from file_directory, with its stored column documents. */
export interface SchemaTableInput {
    id: number;
    name: string;
    columns: any[];
    /** The table's folder; null, 0 or a folder that isn't live means the top level */
    parent_id?: number | null;
}

/** One of the account's live folders. */
export interface SchemaFolder {
    id: number;
    name: string;
    /** null at the top level */
    parent_id: number | null;
}

/** What to draw: one folder (with its subfolders) or the tables in no folder. */
export type SchemaFolderPick = number | 'unfiled';

export interface SchemaOptions {
    /** The account's live folders (also answered, for the frontend's picker) */
    folders?: SchemaFolder[];
    /** Absent or null: every table */
    folder?: SchemaFolderPick | null;
    /** Leave out every card with no arrow in the view */
    linked_only?: boolean;
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
    /** A table from another folder, drawn because it's linked to the picked folder's tables */
    outside: boolean;
    /** The name of the table's folder; null at the top level */
    folder_name: string | null;
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
    /** The account's live folders, by name (empty without any) */
    folders: SchemaFolder[];
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

/** A pair of tables joined by an arrow (a link column or a suggestion). */
export interface SchemaPair {
    from: number;
    to: number;
}

/** The folder and every folder under it, at any depth (a cycle can't loop). */
export function folder_and_subfolders(folders: SchemaFolder[], root: number): Set<number> {
    const out = new Set<number>();
    if (!(folders || []).some(f => f.id === root)) return out;
    const queue = [root];
    out.add(root);
    while (queue.length > 0) {
        const id = queue.shift();
        for (const f of folders) {
            if (f.parent_id === id && !out.has(f.id)) {
                out.add(f.id);
                queue.push(f.id);
            }
        }
    }
    return out;
}

/**
 * The folder a table is in, or null at the top level: no parent, 0, or a parent that isn't
 * one of the live folders.
 */
export function table_folder_id(
    parent_id: number | null | undefined,
    folder_ids: Set<number>
): number | null {
    if (parent_id === null || parent_id === undefined) return null;
    const id = Number(parent_id);
    return id && folder_ids.has(id) ? id : null;
}

/** The tables a pick is about: those in the folder or its subfolders, or those in no folder. */
export function picked_table_ids(
    tables: { id: number; parent_id?: number | null }[],
    folders: SchemaFolder[],
    pick: SchemaFolderPick
): Set<number> {
    const live = new Set((folders || []).map(f => f.id));
    if (pick === 'unfiled') {
        return new Set(
            tables.filter(t => table_folder_id(t.parent_id, live) === null).map(t => t.id)
        );
    }
    const under = folder_and_subfolders(folders || [], pick);
    return new Set(
        tables.filter(t => under.has(table_folder_id(t.parent_id, live))).map(t => t.id)
    );
}

/**
 * The tables one hop from the picked ones, in either direction (they point at a picked table,
 * or a picked table points at them), that aren't picked themselves. Never a second hop.
 */
export function one_hop_ids(picked: Set<number>, pairs: SchemaPair[]): Set<number> {
    const out = new Set<number>();
    for (const p of pairs) {
        if (picked.has(p.from) && !picked.has(p.to)) out.add(p.to);
        if (picked.has(p.to) && !picked.has(p.from)) out.add(p.from);
    }
    return out;
}

/** The arrows drawn for a pick: only those touching a picked table. */
export function pairs_touching<T extends SchemaPair>(pairs: T[], picked: Set<number>): T[] {
    return pairs.filter(p => picked.has(p.from) || picked.has(p.to));
}

/** "Only linked tables": the shown tables with an arrow (in or out) between shown tables. */
export function linked_only_ids(shown: Set<number>, pairs: SchemaPair[]): Set<number> {
    const out = new Set<number>();
    for (const p of pairs) {
        if (shown.has(p.from) && shown.has(p.to)) {
            out.add(p.from);
            out.add(p.to);
        }
    }
    return out;
}

/**
 * The layout order of a view: the picked folder's own tables first (grouped as `layout_order`
 * does), then the outside ones, by name.
 */
export function view_order(
    tables: { id: number; name: string }[],
    outside: Set<number>,
    pairs: [number, number][]
): number[] {
    const own = tables.filter(t => !outside.has(t.id));
    const others = tables.filter(t => outside.has(t.id));
    return [...layout_order(own, pairs), ...layout_order(others, [])];
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

/**
 * The whole diagram: cards placed on a grid, link and suggestion arrows between them. Without
 * a folder, every table; with one, its tables and those one hop away (see the top).
 */
export function build_schema_diagram(
    input: SchemaTableInput[],
    options: SchemaOptions = {}
): SchemaDiagram {
    const folders = [...(options.folders || [])].sort(
        (a, b) => String(a.name).localeCompare(String(b.name)) || a.id - b.id
    );
    const folder_ids = new Set(folders.map(f => f.id));
    const folder_names = new Map(folders.map(f => [f.id, f.name]));
    const all_tables = (input || []).map(t => ({
        id: Number(t.id),
        name: String(t.name ?? ''),
        parent_id: t.parent_id ?? null,
        all_columns: schema_columns(t.columns)
    }));
    const ids = new Set(all_tables.map(t => t.id));

    // Links to a table that isn't the account's (or is gone) aren't drawn
    let links: { from: number; field: string; to: number }[] = [];
    let suggestions: { from: number; field: string; to: number }[] = [];
    for (const t of all_tables) {
        for (const c of t.all_columns) {
            if (c.type === 'link') {
                if (c.link_table_id !== undefined && ids.has(c.link_table_id)) {
                    links.push({ from: t.id, field: c.field, to: c.link_table_id });
                }
                continue;
            }
            // Worked out over every table, so a pick never changes what a column suggests
            const target = suggested_target(c.name, t.id, all_tables);
            if (target === null) continue;
            // Already linked that way: nothing to suggest
            if (t.all_columns.some(o => o.type === 'link' && o.link_table_id === target)) {
                continue;
            }
            suggestions.push({ from: t.id, field: c.field, to: target });
        }
    }

    // A pick: its tables, those one hop away, and only the arrows touching its tables
    let shown = ids;
    let outside = new Set<number>();
    if (options.folder !== undefined && options.folder !== null) {
        const picked = picked_table_ids(all_tables, folders, options.folder);
        outside = one_hop_ids(picked, [...links, ...suggestions]);
        shown = new Set([...picked, ...outside]);
        links = pairs_touching(links, picked);
        suggestions = pairs_touching(suggestions, picked);
    }
    if (options.linked_only) shown = linked_only_ids(shown, [...links, ...suggestions]);
    links = links.filter(l => shown.has(l.from) && shown.has(l.to));
    suggestions = suggestions.filter(l => shown.has(l.from) && shown.has(l.to));
    const tables = all_tables.filter(t => shown.has(t.id));

    const order = view_order(
        tables,
        outside,
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
            outside: outside.has(t.id),
            folder_name: folder_names.get(table_folder_id(t.parent_id, folder_ids)) ?? null,
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
        folders,
        // Room on the right for arrows that leave and come back on the right side
        width: width + GAP_X / 2,
        height
    };
}
