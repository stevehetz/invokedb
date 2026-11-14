<template>
    <div class="app" v-if="loaded">
        <router-view slot="body" />
    </div>
</template>
<script>
import cookies from 'js-cookie';
import { store } from '@/store';
import EnvHttp from '@/network/http/env/env-http';
import AccountHttp from '@/network/http/account/account-http';

let env_http = new EnvHttp();
let account_http = new AccountHttp();

export default {
    data: () => {
        return {
            loaded: false
        };
    },
    name: 'App',
    async created() {
        let env = await env_http.get();
        store.set('env', env);

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
