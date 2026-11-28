// Schema diagram (#208): every table of the account as a card with its columns and their
// types, link columns (#147) as arrows to the table they link to, and suggested links (a
// column named like another table's id) as dashed arrows. The server lays it out
// (`GET /file-directory/schema`, core/schema-diagram); this draws it as SVG. Clicking a card
// opens the table. Opened by the Tables page through `container-dialog:open`, with
// `props: { open_folder }` (the open table's folder id, 'unfiled', or null with none open).
//
// Folders (#376): a picker shows All tables, Unfiled or one folder (with its subfolders); the
// server adds the tables one hop away, marked `outside` (dimmed, dashed, with their folder's
// name). "Only linked tables" hides cards with no arrow. The last choice is kept in
// localStorage; the open table's folder wins over the kept folder.
import { defineComponent } from 'vue';
import { bus } from '@/core/bus';
import { tree_manager } from '@/components/h-tree/tree-manager';

// The server's card geometry (core/schema-diagram/schema-diagram.ts)
const HEADER_HEIGHT = 32;
const ROW_HEIGHT = 22;

const ZOOMS = [0.5, 0.65, 0.8, 1, 1.25];

const STORAGE_KEY = 'invokedb:schema-diagram';
/** The picker's value for every table */
export const ALL = 'all';

/**
 * @typedef {{ field: string, name: string, type: string, link_table_id?: number }} SchemaColumn
 * @typedef {{ id: number, name: string, columns: SchemaColumn[], hidden_columns: number,
 *   outside?: boolean, folder_name?: string | null,
 *   x: number, y: number, width: number, height: number }} SchemaTable
 * @typedef {{ from_table_id: number, from_field: string, to_table_id: number,
 *   suggested: boolean, x1: number, y1: number, x2: number, y2: number,
 *   from_side: 'left' | 'right', to_side: 'left' | 'right' }} SchemaEdge
 * @typedef {{ id: number, name: string, parent_id: number | null }} SchemaFolder
 * @typedef {{ tables: SchemaTable[], links: SchemaEdge[], suggestions: SchemaEdge[],
 *   folders?: SchemaFolder[], width: number, height: number }} SchemaDiagram
 * @typedef {number | 'unfiled' | 'all'} FolderPick
 */

/**
 * The picker's folder options: each folder followed by its subfolders, indented, by name.
 * A folder whose parent isn't listed counts as top level.
 * @param {SchemaFolder[]} folders
 * @returns {{ id: number, name: string, depth: number }[]}
 */
export function folder_options(folders) {
    const list = folders || [];
    const ids = new Set(list.map(f => f.id));
    /** @type {{ id: number, name: string, depth: number }[]} */
    const out = [];
    const seen = new Set();
    /** @param {number | null} parent @param {number} depth */
    const visit = (parent, depth) => {
        list.filter(f =>
            parent === null
                ? f.parent_id === null || !ids.has(f.parent_id)
                : f.parent_id === parent
        )
            .sort((a, b) => String(a.name).localeCompare(String(b.name)))
            .forEach(f => {
                if (seen.has(f.id)) return;
                seen.add(f.id);
                out.push({ id: f.id, name: f.name, depth });
                visit(f.id, depth + 1);
            });
    };
    visit(null, 0);
    return out;
}

/** @returns {{ folder: FolderPick, linked_only: boolean }} */
function remembered() {
    try {
        const kept = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
        if (kept && typeof kept === 'object') {
            const f = kept.folder;
            return {
                folder:
                    f === 'unfiled' || (Number.isInteger(f) && f > 0) ? f : ALL,
                linked_only: kept.linked_only === true
            };
        }
    } catch (ex) {
        // Storage off or a bad value: start fresh
    }
    return { folder: ALL, linked_only: false };
}

/** @param {FolderPick} folder @param {boolean} linked_only */
function remember(folder, linked_only) {
    try {
        localStorage.setItem(
            STORAGE_KEY,
            JSON.stringify({ folder, linked_only })
        );
    } catch (ex) {
        // Storage off: nothing kept
    }
}

/** @param {string} text @param {number} max */
export function clip(text, max) {
    const s = String(text ?? '');
    return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

/**
 * An arrow's SVG path: a curve leaving the column's row sideways and entering the linked
 * card's header from the side the server chose.
 * @param {SchemaEdge} e
 */
export function edge_path(e) {
    const bend = Math.max(40, Math.abs(e.x2 - e.x1) / 2);
    const c1 = e.x1 + (e.from_side === 'right' ? bend : -bend);
    const c2 = e.x2 + (e.to_side === 'right' ? bend : -bend);
    return `M ${e.x1} ${e.y1} C ${c1} ${e.y1}, ${c2} ${e.y2}, ${e.x2} ${e.y2}`;
}

export default defineComponent({
    props: ['props'],

    data() {
        return {
            /** @type {FolderPick} */
            folder: ALL,
            linked_only: false,
            /** @type {SchemaFolder[]} the account's folders, from the last answer */
            folders: [],
            loading: true,
            /** @type {string | null} */
            error: null,
            /** @type {SchemaDiagram | null} */
            diagram: null,
            zoom_index: 3,
            /** @type {number | null} the card under the pointer */
            hover: null,
            header_height: HEADER_HEIGHT,
            row_height: ROW_HEIGHT
        };
    },

    computed: {
        /** @returns {number} */
        zoom() {
            return ZOOMS[this.zoom_index];
        },

        /** @returns {Record<number, string>} */
        names() {
            /** @type {Record<number, string>} */
            const out = {};
            (this.diagram ? this.diagram.tables : []).forEach(
                t => (out[t.id] = t.name)
            );
            return out;
        },

        /** @returns {{ id: number, name: string, depth: number }[]} */
        folder_list() {
            return folder_options(this.folders);
        },

        /** @returns {string} the message when nothing is drawn */
        empty_text() {
            if (this.folder === ALL && !this.linked_only)
                return 'No tables yet.';
            if (this.linked_only) return 'No linked tables here.';
            return this.folder === 'unfiled'
                ? 'No tables outside folders.'
                : 'No tables in this folder.';
        },

        /** @returns {(SchemaEdge & { key: string, path: string })[]} */
        edges() {
            if (!this.diagram) return [];
            return [...this.diagram.suggestions, ...this.diagram.links].map(
                e => ({
                    ...e,
                    key: `${e.suggested ? 's' : 'l'}:${e.from_table_id}:${e.from_field}`,
                    path: edge_path(e)
                })
            );
        },

        /** @returns {{ key: string, text: string }[]} */
        suggestion_notes() {
            if (!this.diagram) return [];
            return this.diagram.suggestions.map(s => {
                const table = this.diagram.tables.find(
                    t => t.id === s.from_table_id
                );
                const col = table
                    ? table.columns.find(c => c.field === s.from_field)
                    : null;
                return {
                    key: `${s.from_table_id}:${s.from_field}`,
                    text: `${table ? table.name : ''}.${col ? col.name : ''} looks like it refers to ${this.names[s.to_table_id]}`
                };
            });
        }
    },

    async mounted() {
        const kept = remembered();
        const open = this.props ? this.props.open_folder : null;
        this.linked_only = kept.linked_only;
        this.folder =
            open === 'unfiled' || (Number.isInteger(open) && open > 0)
                ? open
                : kept.folder;
        await this.load();
    },

    methods: {
        clip,

        /** Fetches the diagram for the current choice; a folder that's gone falls back to all. */
        async load() {
            this.loading = true;
            this.error = null;
            try {
                let diagram;
                try {
                    diagram = await tree_manager.get_schema(this.query());
                } catch (ex) {
                    if (!ex || ex.status !== 404 || this.folder === ALL)
                        throw ex;
                    this.folder = ALL;
                    remember(this.folder, this.linked_only);
                    diagram = await tree_manager.get_schema(this.query());
                }
                this.folders = diagram.folders || [];
                // No folders: no picker, and every table (Unfiled would draw the same)
                if (this.folders.length === 0) this.folder = ALL;
                this.diagram = diagram;
            } catch (ex) {
                this.error =
                    (ex && ex.message) || 'Could not load the schema diagram';
            }
            this.loading = false;
        },

        query() {
            return {
                folder: this.folder === ALL ? null : this.folder,
                linked_only: this.linked_only
            };
        },

        /** The picker or the checkbox changed */
        async choice_changed() {
            remember(this.folder, this.linked_only);
            await this.load();
        },

        /** @param {number} depth */
        indent(depth) {
            return '    '.repeat(depth);
        },

        /** @param {SchemaColumn} col */
        type_label(col) {
            if (col.type === 'link') {
                const target =
                    col.link_table_id !== undefined
                        ? this.names[col.link_table_id]
                        : '';
                return '→ ' + clip(target || 'link', 12);
            }
            return col.type;
        },

        /** @param {number} delta */
        set_zoom(delta) {
            this.zoom_index = Math.min(
                ZOOMS.length - 1,
                Math.max(0, this.zoom_index + delta)
            );
        },

        /** @param {SchemaEdge} e */
        edge_active(e) {
            return (
                this.hover !== null &&
                (e.from_table_id === this.hover || e.to_table_id === this.hover)
            );
        },

        /** @param {number} id */
        open_table(id) {
            bus.$emit('container-dialog:close');
            bus.$emit('table:open', id);
        }
    }
});
