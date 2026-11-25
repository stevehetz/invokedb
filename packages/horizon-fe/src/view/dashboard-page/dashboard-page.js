// A dashboard's read-only share link (#209): `/d/<token>`. Anyone with the link sees the
// dashboard's tiles, read live and refreshed every minute while the page is open; the owner can
// revoke or replace the link. It's outside both areas' shells, so it brings its own (scoped) CSS.
import { defineComponent } from 'vue';
import DashboardTiles from '@/components/dashboard-tiles/index.vue';
import { public_dashboard_http } from '@/core/context/dashboard/dashboard-http';

const REFRESH_MS = 60 * 1000;

export default defineComponent({
    components: { 'dashboard-tiles': DashboardTiles },

    data() {
        return {
            loading: true,
            /** @type {any} */
            dashboard: null,
            /** @type {string | null} */
            unavailable: null,
            /** @type {Date | null} */
            read_at: null,
            /** @type {ReturnType<typeof setInterval> | null} */
            timer: null
        };
    },

    computed: {
        /** @returns {string} */
        updated_text() {
            return this.read_at ? this.read_at.toLocaleTimeString() : '';
        }
    },

    async mounted() {
        await this.load();
        this.timer = setInterval(() => {
            if (!document.hidden && this.dashboard) this.load();
        }, REFRESH_MS);
    },

    beforeUnmount() {
        if (this.timer) clearInterval(this.timer);
    },

    methods: {
        async load() {
            const token = String(this.$route.params.token || '');
            try {
                this.dashboard = await public_dashboard_http.get(token);
                this.read_at = new Date();
                this.unavailable = null;
                document.title = `${this.dashboard.name} | InvokeDB`;
            } catch (ex) {
                // A revoked link stops showing on the next refresh, too
                this.dashboard = null;
                this.unavailable =
                    (ex && ex.status && ex.message) ||
                    'This dashboard could not be loaded. Try again later.';
            }
            this.loading = false;
        }
    }
});
