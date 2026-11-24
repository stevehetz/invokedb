// @ts-nocheck: not type-checked yet
import { createRouter, createWebHistory } from 'vue-router';

import { toggle_page_overlay } from '@/components/_page/page-overlay';

// Pages are loaded lazily so each area's code (ag-grid, highlight.js, ...) stays out of the
// entry chunk. All CSS is imported by the two shells below, so this doesn't change CSS order.

// Main app (signed in)
const Home = () => import('@/components/home');
const Account = () => import('@/components/account');
const Docs = () => import('@/components/docs');
const Guide = () => import('@/components/guide');

// Public site (marketing, login, signup)
const SiteHome = () => import('@/view/pages/home');
const Login = () => import('@/view/pages/login');
const CreateAccount = () => import('@/view/pages/create-account');
const ForgotPassword = () => import('@/view/pages/forgot-password');
const ResetPassword = () => import('@/view/pages/reset-password');
const Pricing = () => import('@/view/pages/pricing');
const Contact = () => import('@/view/pages/contact');
const Tos = () => import('@/view/pages/tos');
const Privacy = () => import('@/view/pages/privacy');

// The public site and the app were separate apps with separate global stylesheets that clash
// (.page, .home-page, .flex-*, Element UI theme). Each area's shell imports its own CSS and is
// loaded lazily, and moving between the areas is a full page load (window.location), so the
// two stylesheets are never on the page together. Within an area, use the router as normal.
const Site = () => import(/* webpackChunkName: "site" */ '@/view/site.vue');
const App = () =>
    import(/* webpackChunkName: "signed-in" */ '@/components/app.vue');

export const APP_PATH = '/app';

const router = createRouter({
    history: createWebHistory(import.meta.env.BASE_URL),
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
                    path: ':pathMatch(.*)*',
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
                { path: 'pricing', name: 'pricing', component: Pricing },
                { path: 'contact', name: 'contact', component: Contact },
                { path: 'tos', name: 'tos', component: Tos },
                { path: 'privacy', name: 'privacy', component: Privacy },
                { path: ':pathMatch(.*)*', redirect: { name: 'site-home' } }
            ]
        }
    ],
    scrollBehavior(to) {
        // The site scrolled to the top on every page change; the app never did
        if (!to.path.startsWith(APP_PATH)) return { left: 0, top: 0 };
    }
});

router.afterEach(to => {
    if (to.path.startsWith(APP_PATH)) toggle_page_overlay(to.path);
});

export default router;
