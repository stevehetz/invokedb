import { store } from '@/store';
import { account_manager } from '@/core/context/account/account-manager';
import { auth_http } from '@/core/context/account/auth-http';
import { choose_theme, get_theme_choice } from '@/core/theme';

export default {
    name: 'Layout',
    data() {
        return {
            account: null,
            active_index: null,
            show_submenu_timeout: 0,
            hide_submenu_timeout: 200,
            submenu_timeout: null,
            nav_listeners: [],
            // The "confirm your email" banner's Resend link (#132)
            resend: { sending: false, sent: false, error: '' },
            // The account menu's theme choice (#290)
            theme: get_theme_choice(),
            themes: [
                {
                    value: 'system',
                    label: 'System',
                    icon: 'fa fa-desktop',
                    title: "Follow this device's light or dark setting"
                },
                {
                    value: 'light',
                    label: 'Light',
                    icon: 'fa fa-sun',
                    title: 'Light'
                },
                {
                    value: 'dark',
                    label: 'Dark',
                    icon: 'fa fa-moon',
                    title: 'Dark'
                }
            ]
        };
    },

    mounted() {
        store.subscribe('account', a => {
            this.account = a;
            this.theme = get_theme_choice();
        });
        this.set_active();
        this.setup_nav_behavior();
    },

    beforeUnmount() {
        this.nav_listeners.forEach(([el, type, fn]) =>
            el.removeEventListener(type, fn)
        );
        document.body.classList.remove('nav-popper-hidden');
    },

    computed: {
        /** The account menu's avatar: the email's first letter. @returns {string} */
        initial() {
            const email = (this.account && this.account.email) || '';
            return (email.trim()[0] || '?').toUpperCase();
        },

        /**
         * The plan under the email in the account menu (docs/PRICING.md 3.2), as
         * GET /auth/authorize answers it from the backend's plan constant (#275).
         * @returns {string}
         */
        plan_name() {
            const plan = this.account && this.account.plan;
            if (!plan || !plan.name) return '';
            return `${plan.name} plan`;
        },

        /** When a payment's grace period ends (#184), for its banner. @returns {string} */
        grace_end() {
            const at = this.account && this.account.grace_ends_at;
            const d = at ? new Date(at) : null;
            if (!d || isNaN(d.getTime())) return 'the end of the grace period';
            return d.toLocaleDateString(undefined, {
                year: 'numeric',
                month: 'long',
                day: 'numeric'
            });
        }
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

        /** The account menu's theme buttons (#290). @param {'system'|'light'|'dark'} choice */
        async set_theme(choice) {
            this.theme = choice;
            try {
                await choose_theme(choice);
            } catch (ex) {
                // Applied and kept in this browser; the account gets it next time
                console.log(ex);
            }
        },

        async resend_verification() {
            if (this.resend.sending) return;
            this.resend.sending = true;
            this.resend.error = '';
            try {
                const res = await auth_http.resend_verification();
                if (res && res.email_verified) {
                    // Verified in another tab meanwhile: the banner goes away
                    await account_manager.refresh_account_store();
                } else {
                    this.resend.sent = true;
                }
            } catch (ex) {
                this.resend.error =
                    (ex && ex.message) || 'Could not send the email';
            } finally {
                this.resend.sending = false;
            }
        },

        // Help and Contact are pages of the site area: opened in place, through the router
        contact() {
            this.$router.push('/contact');
        },

        /** An item of the account menu. @param {string} command */
        account_command(command) {
            if (command === 'settings') this.$router.push('/app/account');
            // Only shown to admins (#277)
            else if (command === 'admin') this.$router.push('/app/admin');
            else if (command === 'contact') this.contact();
            else if (command === 'logout') this.logout();
        },

        async logout() {
            await account_manager.logout();
            // A full page load on purpose (not the router): it drops everything the app holds
            // in memory for this account and closes the websocket
            window.location.href = '/';
        },

        async nav_selected(e) {
            if (e === this.$route.path) return;
            this.$router.push(e);
        }
    }
};
