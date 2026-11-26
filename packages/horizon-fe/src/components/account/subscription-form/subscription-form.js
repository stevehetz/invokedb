// The Account page's plan and usage (#183): the plan's caps and how much of each the account
// uses, as meters, from GET /usage. A refusal at a cap ("plan_limit") links here.
import { defineComponent } from 'vue';
import { plan_http } from '@/core/context/plan/plan-http';
import {
    USAGE_ROWS,
    bytes_label,
    count_label,
    meter
} from '@/core/context/plan/plan';

export default defineComponent({
    name: 'SubscriptionForm',

    props: ['account'],

    data() {
        return {
            loading: true,
            /** @type {any} */
            usage: null,
            error: '',
            account_locked: false,
            account_locked_reason: null
        };
    },

    computed: {
        plan_name() {
            const u = this.usage;
            if (!u) return '';
            return u.internal ? `${u.plan.name} (no caps)` : u.plan.name;
        },

        meters() {
            const u = this.usage;
            if (!u) return [];
            return USAGE_ROWS.map(row => meter(row, u.usage[row.key]));
        }
    },

    watch: {
        account: {
            /** @param {any} account */
            handler(account) {
                if (!account) return;
                this.account_locked = account.locked;
                this.account_locked_reason = account.locked_reason;
            },
            immediate: true
        }
    },

    async mounted() {
        await this.load();
    },

    methods: {
        count_label,
        bytes_label,

        async load() {
            try {
                this.usage = await plan_http.usage();
                this.error = '';
            } catch (ex) {
                this.error =
                    (ex && ex.message) || "Your usage couldn't be loaded.";
            } finally {
                this.loading = false;
            }
        }
    }
});
