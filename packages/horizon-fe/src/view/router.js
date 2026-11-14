import Vue from 'vue';
import Router from 'vue-router';
import Home from '@/view/pages/home';
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

export default new Router({
    mode: 'history',
    base: process.env.BASE_URL,
    routes: [
        {
            path: '/',
            name: 'home',
            component: Home
        },
        {
            path: '/login',
            name: 'login',
            component: Login
        },
        {
            path: '/create-account',
            name: 'create-account',
            component: CreateAccount
        },
        {
            path: '/forgot-password',
            name: 'forgot-password',
            component: ForgotPassword
        },
        {
            path: '/reset-password',
            name: 'reset-password',
            component: ResetPassword
        },
        {
            path: '/checkout',
            name: 'checkout',
            component: Checkout
        },
        {
            path: '/pricing',
            name: 'pricing',
            component: Pricing
        },
        {
            path: '/contact',
            name: 'contact',
            component: Contact
        },
        {
            path: '/tos',
            name: 'tos',
            component: Tos
        },
        {
            path: '/privacy',
            name: 'privacy',
            component: Privacy
        },
        {
            path: '*',
            redirect: { name: 'home' }
        }
    ],
    scrollBehavior() {
        return { x: 0, y: 0 };
    }
});
