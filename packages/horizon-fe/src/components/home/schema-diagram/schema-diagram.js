// Schema diagram (#208): every table of the account as a card with its columns and their
// types, link columns (#147) as arrows to the table they link to, and suggested links (a
// column named like another table's id) as dashed arrows. The server lays it out
// (`GET /file-directory/schema`, core/schema-diagram); this draws it as SVG. Clicking a card
// opens the table. Opened by the Tables page through `container-dialog:open`.
import { defineComponent } from 'vue';
import { bus } from '@/core/bus';
import { tree_manager } from '@/components/h-tree/tree-manager';

// The server's card geometry (core/schema-diagram/schema-diagram.ts)
const HEADER_HEIGHT = 32;
const ROW_HEIGHT = 22;

const ZOOMS = [0.5, 0.65, 0.8, 1, 1.25];

/**
 * @typedef {{ field: string, name: string, type: string, link_table_id?: number }} SchemaColumn
 * @typedef {{ id: number, name: string, columns: SchemaColumn[], hidden_columns: number,
 *   x: number, y: number, width: number, height: number }} SchemaTable
 * @typedef {{ from_table_id: number, from_field: string, to_table_id: number,
 *   suggested: boolean, x1: number, y1: number, x2: number, y2: number,
 *   from_side: 'left' | 'right', to_side: 'left' | 'right' }} SchemaEdge
 * @typedef {{ tables: SchemaTable[], links: SchemaEdge[], suggestions: SchemaEdge[],
 *   width: number, height: number }} SchemaDiagram
 */

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
        try {
            this.diagram = await tree_manager.get_schema();
        } catch (ex) {
            this.error =
                (ex && ex.message) || 'Could not load the schema diagram';
        }
        this.loading = false;
    },

    methods: {
        clip,

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
