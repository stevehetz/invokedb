// A refusal at the plan's cap (#183): any request the backend answers with `plan_limit`
// (core/http emits it on the bus) shows this notice, with links to the Account page's usage
// and to the plans. The screen that made the request still shows its own error.
import { defineComponent } from 'vue';
import { bus } from '@/core/bus';
import { sign_up_from_demo } from '@/core/demo';

// How long the notice stays up
const SHOW_MS = 10000;

export default defineComponent({
    name: 'PlanLimitNotice',

    data() {
        return {
            /** @type {{ message: string, demo: boolean } | null} */
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
                    "You've reached a limit of your plan.",
                // Off in the no-signup demo (#333): signing up, not upgrading
                demo: !!body && body.code === 'demo_account'
            };
            clearTimeout(this.timer);
            this.timer = setTimeout(() => this.hide(), SHOW_MS);
        },

        sign_up() {
            this.hide();
            sign_up_from_demo();
        },

        hide() {
            this.notice = null;
            clearTimeout(this.timer);
        }
    }
});
