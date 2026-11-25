// A refusal at the plan's cap (#183): any request the backend answers with `plan_limit`
// (core/http emits it on the bus) shows this notice, with links to the Account page's usage
// and to the plans. The screen that made the request still shows its own error.
import { defineComponent } from 'vue';
import { bus } from '@/core/bus';

// How long the notice stays up
const SHOW_MS = 10000;

export default defineComponent({
    name: 'PlanLimitNotice',

    data() {
        return {
            /** @type {{ message: string } | null} */
            notice: null,
            /** @type {any} */
            timer: null
        };
    },

    mounted() {
        bus.$on('plan_limit', this.show);
    },

    beforeUnmount() {
        bus.$off('plan_limit', this.show);
        clearTimeout(this.timer);
    },

    methods: {
        /** @param {any} body the refusal: `{ message, code, limit, cap, plan, upgrade_url }` */
        show(body) {
            this.notice = {
                message:
                    (body &&
                        typeof body.message === 'string' &&
                        body.message) ||
                    "You've reached a limit of your plan."
            };
            clearTimeout(this.timer);
            this.timer = setTimeout(() => this.hide(), SHOW_MS);
        },

        hide() {
            this.notice = null;
            clearTimeout(this.timer);
        }
    }
});
