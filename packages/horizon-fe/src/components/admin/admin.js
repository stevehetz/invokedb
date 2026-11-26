// The admin area (#277), /app/admin, only for admins (the backend answers 404 to anyone else):
// the overview, the accounts list and, with ?account=<id>, one account's page.
import { defineComponent } from 'vue';
import { admin_http } from '@/core/context/admin/admin-http';
import {
    ACCOUNT_COLUMNS,
    ADMIN_PLANS,
    bytes_label,
    cap_label,
    count_label,
    date_label,
    signup_bars,
    time_label,
    usd_label
} from '@/core/context/admin/admin';
import AccountDetail from './account-detail/index.vue';

const PAGE_SIZE = 25;

/** @param {any} ex @param {string} fallback */
function message_of(ex, fallback) {
    if (ex && (ex.statusCode === 404 || ex.status === 404))
        return "This page isn't available.";
    return (ex && ex.message) || fallback;
}

export default defineComponent({
    name: 'Admin',

    components: { AccountDetail },

    data() {
        return {
            tab: 'overview',
            /** @type {any} */
            overview: null,
            overview_error: '',
            /** @type {any} */
            list: null,
            list_error: '',
            loading: false,
            query: {
                search: '',
                sort: 'created_at',
                dir: 'desc',
                page: 1,
                caps: 'all',
                plan: ''
            },
            columns: ACCOUNT_COLUMNS,
            plans: ADMIN_PLANS,
            /** @type {number | undefined} */
            search_timer: undefined
        };
    },

    computed: {
        /** @returns {number | null} the account shown, from ?account= */
        account_id() {
            const id = Number(this.$route.query.account);
            return Number.isInteger(id) && id > 0 ? id : null;
        },

        bars() {
            return this.overview ? signup_bars(this.overview.signups) : [];
        },

        signups_total() {
            return this.bars.reduce((s, b) => s + b.count, 0);
        },

        /** @returns {number} */
        pages() {
            if (!this.list) return 1;
            return Math.max(1, Math.ceil(this.list.total / this.list.limit));
        },

        ai_percent() {
            const ai = this.overview && this.overview.ai;
            if (!ai || !ai.budget_usd) return 0;
            return Math.min(
                100,
                Math.round((ai.spent_usd / ai.budget_usd) * 100)
            );
        }
    },

    mounted() {
        this.load_overview();
    },

    beforeUnmount() {
        window.clearTimeout(this.search_timer);
    },

    methods: {
        bytes_label,
        count_label,
        date_label,
        time_label,
        usd_label,
        cap_label,

        async load_overview() {
            this.overview_error = '';
            try {
                this.overview = await admin_http.overview();
            } catch (ex) {
                this.overview_error = message_of(
                    ex,
                    "The overview couldn't be loaded."
                );
            }
        },

        async load_list() {
            this.loading = true;
            this.list_error = '';
            try {
                this.list = await admin_http.accounts({
                    ...this.query,
                    limit: PAGE_SIZE
                });
            } catch (ex) {
                this.list_error = message_of(
                    ex,
                    "The accounts couldn't be loaded."
                );
            } finally {
                this.loading = false;
            }
        },

        /** @param {string} tab */
        show_tab(tab) {
            this.tab = tab;
            if (this.account_id) this.$router.push({ query: {} });
            if (tab === 'accounts' && !this.list) this.load_list();
            if (tab === 'overview') this.load_overview();
        },

        search_changed() {
            window.clearTimeout(this.search_timer);
            this.search_timer = window.setTimeout(() => {
                this.query.page = 1;
                this.load_list();
            }, 300);
        },

        filter_changed() {
            this.query.page = 1;
            this.load_list();
        },

        /** The over-cap filter, from the overview's figures. @param {string} caps */
        show_capped(caps) {
            this.query.caps = caps;
            this.query.page = 1;
            this.tab = 'accounts';
            this.load_list();
        },

        /** @param {string} key */
        sort_by(key) {
            if (this.query.sort === key) {
                this.query.dir = this.query.dir === 'asc' ? 'desc' : 'asc';
            } else {
                this.query.sort = key;
                this.query.dir =
                    key === 'email' || key === 'plan' ? 'asc' : 'desc';
            }
            this.query.page = 1;
            this.load_list();
        },

        /** @param {string} key */
        sort_icon(key) {
            if (this.query.sort !== key) return '';
            return this.query.dir === 'asc'
                ? 'fa fa-caret-up'
                : 'fa fa-caret-down';
        },

        /** @param {number} delta */
        go_page(delta) {
            const page = this.query.page + delta;
            if (page < 1 || page > this.pages) return;
            this.query.page = page;
            this.load_list();
        },

        /** @param {number} id */
        open_account(id) {
            this.$router.push({ query: { account: String(id) } });
        },

        close_account() {
            this.$router.push({ query: {} });
            this.tab = 'accounts';
            this.load_list();
        },

        /** @param {any} row */
        cap_level(row) {
            if (row.caps.some(c => c.level === 'over')) return 'over';
            if (row.caps.length > 0) return 'near';
            return '';
        }
    }
});
