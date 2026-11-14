import { store } from '@/store';
import { account_manager } from '@/core/context/account/account-manager';

export default {
    name: 'Layout',
    data() {
        return {
            account: null,
            $nav: null,
            active_index: null,
            show_submenu_timeout: 0,
            hide_submenu_timeout: 200,
            submenu_timeout: null
        };
    },

    mounted() {
        store.subscribe('account', a => (this.account = a));
        this.set_active();
        this.setup_nav_behavior();
    },

    destroyed() {
        $('body').removeClass('nav-popper-hidden');
    },

    watch: {
        $route() {
            this.set_active();
        }
    },

    methods: {
        set_active() {
            // get the 2nd slash if it exists (ex: /manage/file-store)
            let end = this.$route.path.substring(1).indexOf('/');

            if (end > -1) {
                // second slash exists so within subpage
                this.active_index = this.$route.path.substring(0, end + 1);
            } else {
                // second slash not present, so not within subpage
                this.active_index = this.$route.path;
            }
        },

        setup_nav_behavior() {
            let self = this;
            let $nav = $(this.$refs.nav.$el);
            $('body').addClass('nav-popper-hidden');
            $nav.click(function(e) {
                $('body').removeClass('nav-popper-hidden');
            });
            $nav.on('mouseenter', () => {
                window.clearTimeout(self.submenu_timeout);
            });
            $('.nav-popper').on('mouseenter', () => {
                window.clearTimeout(self.submenu_timeout);
            });
            $nav.on('mouseleave', () => {
                self.submenu_timeout = window.setTimeout(() => {
                    $('body').addClass('nav-popper-hidden');
                }, 1500);
            });
            $('.nav-popper').on('mouseleave', () => {
                self.submenu_timeout = window.setTimeout(() => {
                    $('body').addClass('nav-popper-hidden');
                }, 1500);
            });
        },

        async contact() {
            window.open(
                store.get('env').HORIZON_AUTH_FE_PUB_HTTP_URL + '/contact',
                '_blank'
            );
        },

        async logout() {
            await account_manager.logout();
            window.location.href = store.get(
                'env'
            ).HORIZON_AUTH_FE_PUB_HTTP_URL;
        },

        async nav_selected(e) {
            if (e === this.$route.path) return;
            this.$router.push(e);
        }
    }
};
