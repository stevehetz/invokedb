import { store } from '@/store';
import { account_manager } from '@/core/context/account/account-manager';

export default {
    name: 'Layout',
    data() {
        return {
            account: null,
            active_index: null,
            show_submenu_timeout: 0,
            hide_submenu_timeout: 200,
            submenu_timeout: null,
            nav_listeners: []
        };
    },

    mounted() {
        store.subscribe('account', a => (this.account = a));
        this.set_active();
        this.setup_nav_behavior();
    },

    beforeUnmount() {
        this.nav_listeners.forEach(([el, type, fn]) =>
            el.removeEventListener(type, fn)
        );
        document.body.classList.remove('nav-popper-hidden');
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
            const body = document.body;
            const hide_later = () => {
                this.submenu_timeout = window.setTimeout(
                    () => body.classList.add('nav-popper-hidden'),
                    1500
                );
            };
            const keep_open = () => window.clearTimeout(this.submenu_timeout);
            const listen = (el, type, fn) => {
                el.addEventListener(type, fn);
                this.nav_listeners.push([el, type, fn]);
            };

            const nav = this.$refs.nav.$el;
            body.classList.add('nav-popper-hidden');
            listen(nav, 'click', () =>
                body.classList.remove('nav-popper-hidden')
            );
            listen(nav, 'mouseenter', keep_open);
            listen(nav, 'mouseleave', hide_later);
            document.querySelectorAll('.nav-popper').forEach(popper => {
                listen(popper, 'mouseenter', keep_open);
                listen(popper, 'mouseleave', hide_later);
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
