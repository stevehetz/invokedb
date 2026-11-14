import Vue from 'vue';
import Router from 'vue-router';

// Main app (signed in)
import Home from '@/components/home';
import Account from '@/components/account';
import Docs from '@/components/docs';
import Guide from '@/components/guide';
import { toggle_page_overlay } from '@/components/_page/page-overlay';

// Public site (marketing, login, signup, checkout)
import SiteHome from '@/view/pages/home';
import Login from '@/view/pages/login';
import CreateAccount from '@/view/pages/create-account';
import ForgotPassword from '@/view/pages/forgot-password';
import ResetPassword from '@/view/pages/reset-password';
import Checkout from '@/view/pages/checkout';
import Pricing from '@/view/pages/pricing';
import Contact from '@/view/pages/contact';
import Tos from '@/view/pages/tos';
import Privacy from '@/view/pages/privacy';

Vue.use(Router);

// The public site and the app were separate apps with separate global stylesheets that clash
// (.page, .home-page, .flex-*, Element UI theme). Each area's shell imports its own CSS and is
// loaded lazily, and moving between the areas is a full page load (window.location), so the
// two stylesheets are never on the page together. Within an area, use the router as normal.
const Site = () => import(/* webpackChunkName: "site" */ '@/view/site.vue');
const App = () =>
    import(/* webpackChunkName: "signed-in" */ '@/components/app.vue');

export const APP_PATH = '/app';

let router = new Router({
    mode: 'history',
    base: import.meta.env.BASE_URL,
    routes: [
        {
            path: APP_PATH,
            component: App,
            children: [
                {
                    path: '',
                    name: 'home',
                    component: Home,
                    children: [
                        {
                            path: 'account',
                            name: 'account',
                            components: {
                                page_overlay: Account
                            }
                        },
                        {
                            path: 'api',
                            name: 'api',
                            components: {
                                page_overlay: Docs
                            }
                        },
                        {
                            path: 'guide',
                            name: 'guide',
                            components: {
                                page_overlay: Guide
                            }
                        }
                    ]
                },
                {
                    path: '*',
                    redirect: { name: 'home' }
                }
            ]
        },
        {
            path: '/',
            component: Site,
            children: [
                { path: '', name: 'site-home', component: SiteHome },
                { path: 'login', name: 'login', component: Login },
                {
                    path: 'create-account',
                    name: 'create-account',
                    component: CreateAccount
                },
                {
                    path: 'forgot-password',
                    name: 'forgot-password',
                    component: ForgotPassword
                },
                {
                    path: 'reset-password',
                    name: 'reset-password',
                    component: ResetPassword
                },
                { path: 'checkout', name: 'checkout', component: Checkout },
                { path: 'pricing', name: 'pricing', component: Pricing },
                { path: 'contact', name: 'contact', component: Contact },
                { path: 'tos', name: 'tos', component: Tos },
                { path: 'privacy', name: 'privacy', component: Privacy },
                { path: '*', redirect: { name: 'site-home' } }
            ]
        }
    ],
    scrollBehavior(to) {
        // The site scrolled to the top on every page change; the app never did
        if (!to.path.startsWith(APP_PATH)) return { x: 0, y: 0 };
    }
});

router.afterEach(to => {
    if (to.path.startsWith(APP_PATH)) toggle_page_overlay(to.path);
});

export default router;
