// Dashboards (#209): pages of chart, table and stat tiles over the account's tables and saved
// views (#146). Tiles hold references, so the page reads their data live (and again every
// minute while it's open). A dashboard can be shared read-only by a link (`/d/<token>`,
// view/dashboard-page) that the owner can replace or revoke. Opened from the app's nav.
import { defineComponent } from 'vue';
import copy from 'copy-to-clipboard';
import { bus } from '@/core/bus';
import { http } from '@/core/http';
import DashboardTiles from '@/components/dashboard-tiles/index.vue';
import {
    dashboard_http,
    dashboard_link
} from '@/core/context/dashboard/dashboard-http';
import { view_http } from '@/core/context/view/view-http';

const REFRESH_MS = 60 * 1000;

export const TILE_TYPES = [
    { value: 'chart', label: 'Chart' },
    { value: 'table', label: 'Table' },
    { value: 'stat', label: 'Stat' }
];

export const STAT_AGGS = [
    { value: 'count', label: 'Count rows' },
    { value: 'sum', label: 'Sum' },
    { value: 'avg', label: 'Average' },
    { value: 'min', label: 'Lowest' },
    { value: 'max', label: 'Highest' }
];

/** @param {any} ex @param {string} fallback */
function message_of(ex, fallback) {
    return (ex && ex.message) || fallback;
}

/**
 * A tile as the server stores it, from the editor's draft or a saved tile: only the settings
 * of its type.
 * @param {any} t
 */
export function tile_settings(t) {
    return {
        id: t.id || undefined,
        type: t.type,
        title: t.title || '',
        file_id: Number(t.file_id),
        view_id: t.view_id || null,
        wide: !!t.wide,
        limit: t.type === 'table' ? Number(t.limit) || 10 : null,
        agg: t.type === 'stat' ? t.agg || 'count' : null,
        value_field:
            t.type === 'stat' && t.agg && t.agg !== 'count'
                ? t.value_field || null
                : null
    };
}

export default defineComponent({
    components: { 'dashboard-tiles': DashboardTiles },

    data() {
        return {
            loading: true,
            /** @type {string | null} */
            error: null,
            /** @type {any[]} */
            dashboards: [],
            /** @type {any} */
            limits: {},
            /** @type {string | null} */
            current_id: null,
            /** @type {any[]} the current dashboard's tiles, with their data */
            tiles: [],
            tiles_loading: false,
            /** @type {Date | null} */
            read_at: null,
            /** @type {{ id: number, name: string }[]} */
            tables: [],
            /** @type {Record<number, { views: any[], columns: any[] }>} */
            table_meta: {},
            new_name: '',
            /** @type {string | null} the current dashboard's name, being edited */
            rename: null,
            /** @type {any} the tile being added or edited */
            draft: null,
            saving: false,
            copied: false,
            /** @type {ReturnType<typeof setTimeout> | undefined} */
            copied_timer: undefined,
            /** @type {ReturnType<typeof setInterval> | undefined} */
            timer: undefined,
            tile_types: TILE_TYPES,
            stat_aggs: STAT_AGGS
        };
    },

    computed: {
        /** @returns {any} */
        current() {
            return this.dashboards.find(d => d.id === this.current_id) || null;
        },

        /** @returns {string | null} */
        share_link() {
            return this.current && this.current.share_token
                ? dashboard_link(this.current.share_token)
                : null;
        },

        /** @returns {boolean} */
        at_limit() {
            return (
                !!this.limits.max_per_account &&
                this.dashboards.length >= this.limits.max_per_account
            );
        },

        /** @returns {any[]} views the draft tile can use */
        draft_views() {
            if (!this.draft || !this.draft.file_id) return [];
            const meta = this.table_meta[this.draft.file_id];
            const views = (meta && meta.views) || [];
            return this.draft.type === 'chart'
                ? views.filter(v => v.type === 'chart')
                : views;
        },

        /** @returns {any[]} number columns, for a stat tile */
        draft_number_columns() {
            if (!this.draft || !this.draft.file_id) return [];
            const meta = this.table_meta[this.draft.file_id];
            return ((meta && meta.columns) || []).filter(
                c => c.type === 'number'
            );
        },

        /** @returns {string} */
        updated_text() {
            return this.read_at ? this.read_at.toLocaleTimeString() : '';
        }
    },

    async mounted() {
        await Promise.all([this.load_list(), this.load_tables()]);
        this.timer = setInterval(() => {
            if (!document.hidden && this.current && !this.draft) {
                this.load_tiles();
            }
        }, REFRESH_MS);
    },

    beforeUnmount() {
        if (this.timer) clearInterval(this.timer);
        if (this.copied_timer) clearTimeout(this.copied_timer);
    },

    methods: {
        async load_list() {
            this.loading = true;
            try {
                const res = await dashboard_http.list();
                this.dashboards = (res && res.dashboards) || [];
                this.limits = (res && res.limits) || {};
                this.error = null;
                if (!this.current && this.dashboards.length > 0) {
                    await this.select(this.dashboards[0].id);
                }
            } catch (ex) {
                this.error = message_of(ex, 'Could not load your dashboards');
            }
            this.loading = false;
        },

        async load_tables() {
            try {
                const files = await http.get(http.get_url('/file-directory'));
                this.tables = (files || [])
                    .filter(f => f.type === 'file' && !f.deleted)
                    .map(f => ({ id: f.id, name: f.name }))
                    .sort((a, b) => a.name.localeCompare(b.name));
            } catch (ex) {
                this.error = message_of(ex, 'Could not load your tables');
            }
        },

        /** A table's views and columns, for the tile editor. @param {number} file_id */
        async load_table_meta(file_id) {
            if (!file_id || this.table_meta[file_id]) return;
            try {
                const res = await view_http.list(file_id);
                this.table_meta = {
                    ...this.table_meta,
                    [file_id]: {
                        views: (res && res.views) || [],
                        columns: (res && res.columns) || []
                    }
                };
            } catch (ex) {
                this.error = message_of(ex, "Could not load the table's views");
            }
        },

        /** @param {string} id */
        async select(id) {
            this.current_id = id;
            this.draft = null;
            this.rename = null;
            this.tiles = [];
            await this.load_tiles();
        },

        async load_tiles() {
            if (!this.current_id) return;
            const id = this.current_id;
            this.tiles_loading = true;
            try {
                const res = await dashboard_http.data(id);
                if (this.current_id !== id) return;
                this.tiles = (res && res.tiles) || [];
                this.read_at = new Date();
                this.error = null;
            } catch (ex) {
                this.error = message_of(ex, 'Could not load the dashboard');
            }
            this.tiles_loading = false;
        },

        /** Puts a dashboard the server answered in the list. @param {any} d */
        replace(d) {
            this.dashboards = this.dashboards.map(x => (x.id === d.id ? d : x));
        },

        async create() {
            const name = this.new_name.trim();
            if (!name) return;
            try {
                const d = await dashboard_http.create({ name, tiles: [] });
                this.dashboards = this.dashboards.concat([d]);
                this.new_name = '';
                this.error = null;
                await this.select(d.id);
                this.add_tile();
            } catch (ex) {
                this.error = message_of(ex, 'Could not create the dashboard');
            }
        },

        start_rename() {
            this.rename = this.current.name;
        },

        async save_rename() {
            const name = (this.rename || '').trim();
            if (!name || name === this.current.name) {
                this.rename = null;
                return;
            }
            try {
                this.replace(
                    await dashboard_http.update(this.current.id, { name })
                );
                this.rename = null;
                this.error = null;
            } catch (ex) {
                this.error = message_of(ex, 'Could not rename the dashboard');
            }
        },

        remove() {
            const d = this.current;
            bus.$emit('confirm-dialog:open', {
                title: 'Delete dashboard',
                message:
                    'Delete this dashboard? Its share link stops working. Your tables and views stay as they are.',
                callback: async () => {
                    try {
                        await dashboard_http.remove(d.id);
                        this.dashboards = this.dashboards.filter(
                            x => x.id !== d.id
                        );
                        this.current_id = null;
                        this.tiles = [];
                        this.draft = null;
                        if (this.dashboards.length > 0) {
                            await this.select(this.dashboards[0].id);
                        }
                        this.error = null;
                    } catch (ex) {
                        this.error = message_of(
                            ex,
                            'Could not delete the dashboard'
                        );
                    }
                }
            });
        },

        // --- Sharing ---

        async share() {
            try {
                this.replace(await dashboard_http.share(this.current.id));
                this.error = null;
            } catch (ex) {
                this.error = message_of(ex, 'Could not share the dashboard');
            }
        },

        new_link() {
            bus.$emit('confirm-dialog:open', {
                title: 'New share link',
                message:
                    'Make a new link? The current link stops working for everyone who has it.',
                callback: () => this.share()
            });
        },

        unshare() {
            bus.$emit('confirm-dialog:open', {
                title: 'Stop sharing',
                message:
                    'Stop sharing this dashboard? Its link stops working for everyone who has it.',
                callback: async () => {
                    try {
                        this.replace(
                            await dashboard_http.unshare(this.current.id)
                        );
                        this.error = null;
                    } catch (ex) {
                        this.error = message_of(ex, 'Could not stop sharing');
                    }
                }
            });
        },

        copy_link() {
            if (!this.share_link) return;
            copy(this.share_link);
            this.copied = true;
            if (this.copied_timer) clearTimeout(this.copied_timer);
            this.copied_timer = setTimeout(() => (this.copied = false), 1500);
        },

        // --- Tiles ---

        add_tile() {
            const file_id = this.tables.length > 0 ? this.tables[0].id : null;
            this.draft = {
                index: null,
                type: 'chart',
                title: '',
                file_id,
                view_id: null,
                wide: false,
                limit: 10,
                agg: 'count',
                value_field: null
            };
            if (file_id) this.load_table_meta(file_id);
        },

        /** @param {number} index */
        edit_tile(index) {
            const t = this.current.tiles[index];
            if (!t) return;
            this.draft = {
                index,
                ...t,
                limit: t.limit || 10,
                agg: t.agg || 'count'
            };
            this.load_table_meta(t.file_id);
        },

        draft_table_changed() {
            this.draft.view_id = null;
            this.draft.value_field = null;
            this.load_table_meta(this.draft.file_id);
        },

        draft_type_changed() {
            if (
                this.draft.type === 'chart' &&
                !this.draft_views.some(v => v.id === this.draft.view_id)
            ) {
                this.draft.view_id = null;
            }
        },

        /** @param {any[]} tiles */
        async save_tiles(tiles) {
            this.saving = true;
            try {
                const d = await dashboard_http.update(this.current.id, {
                    tiles: tiles.map(tile_settings)
                });
                this.replace(d);
                this.error = null;
                this.saving = false;
                await this.load_tiles();
                return true;
            } catch (ex) {
                this.error = message_of(ex, 'Could not save the tiles');
                this.saving = false;
                return false;
            }
        },

        async save_draft() {
            const tiles = this.current.tiles.slice();
            const { index, ...tile } = this.draft;
            if (index === null) tiles.push(tile);
            else tiles[index] = tile;
            if (await this.save_tiles(tiles)) this.draft = null;
        },

        /** @param {number} index */
        async remove_tile(index) {
            const tiles = this.current.tiles.filter(
                (/** @type {any} */ t, /** @type {number} */ i) => i !== index
            );
            if (this.draft && this.draft.index === index) this.draft = null;
            await this.save_tiles(tiles);
        }
    }
});
