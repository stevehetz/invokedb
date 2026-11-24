<template>
    <div class="app" v-if="loaded">
        <router-view />
    </div>
</template>
<script>
// The public site's shell (marketing, login, signup). It owns the site's global CSS;
// see router.js for why.
import 'element-plus/dist/index.css';
import './stylesheet.scss';

import cookies from 'js-cookie';
import { store } from '@/store';
import AccountHttp from '@/network/http/account/account-http';

let account_http = new AccountHttp();

export default {
    data: () => {
        return {
            loaded: false
        };
    },
    name: 'Site',
    async created() {
        const token = cookies.get('token');
        if (token) {
            try {
                const account = await account_http.authorize(token);
                store.set('account', account);
            } catch (ex) {
                cookies.remove('token');
            }
        }

        this.loaded = true;
    }
};
</script>
