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
            // The nav item is the first two path segments (ex: /app/manage/file-store -> /app/manage)
            const parts = this.$route.path.split('/').filter(p => p);
            this.active_index = '/' + parts.slice(0, 2).join('/');
        },

        setup_nav_behavior() {
            let self = this;
            let $nav = $(this.$refs.nav.$el);
            $('body').addClass('nav-popper-hidden');
            $nav.click(function (e) {
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
            window.open('/contact', '_blank');
        },

        async logout() {
            await account_manager.logout();
            window.location.href = '/'; // the public site: a full page load
        },

        async nav_selected(e) {
            if (e === this.$route.path) return;
            this.$router.push(e);
        }
    }
};
