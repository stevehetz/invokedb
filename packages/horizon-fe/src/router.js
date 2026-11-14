import Vue from 'vue';
import Router from 'vue-router';
import Home from '@/components/home';
import Account from '@/components/account';
import Docs from '@/components/docs';
import Guide from '@/components/guide';
import { toggle_page_overlay } from '@/components/_page/page-overlay';

Vue.use(Router);

let router = new Router({
    mode: 'history',
    base: process.env.BASE_URL,
    routes: [
        {
            path: '/',
            name: 'home',
            component: Home,
            children: [
                /*{
                    path: '/manage',
                    name: 'manage',
                    components: {
                        page_overlay: Manage
                    },
                    children: [
                        {
                            path: 'api',
                            name: 'api',
                            component: Api
                        },
                        {
                            path: 'trash',
                            name: 'trash',
                            component: Trash
                        }
                    ]
                },*/
                {
                    path: '/account',
                    name: 'account',
                    components: {
                        page_overlay: Account
                    }
                },
                {
                    path: '/api',
                    name: 'api',
                    components: {
                        page_overlay: Docs
                    }
                },
                {
                    path: '/guide',
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
});

router.afterEach((to, from) => {
    toggle_page_overlay(to.path);
});

export default router;
