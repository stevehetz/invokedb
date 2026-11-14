<script>
import cookies from 'js-cookie';
import ViewBusContainer from '@/components/view-bus/view-bus-container';
import Layout from '@/components/layout';
import { http } from '@/core/http';
import { store } from '@/store';
import { account_manager } from '@/core/context/account/account-manager';
import { socket_service } from '@/core/ws/socket-service';

export default {
    name: 'App',

    data: () => {
        return {
            loading: true,
            env: null,
            account: null
        };
    },

    components: {
        layout: Layout,
        'view-bus-container': ViewBusContainer
    },

    async created() {
        await this.set_env();
        await this.set_account();
        this.set_handlers();
    },

    methods: {
        async set_env() {
            const date = new Date();
            const env = await http.get(`/env.txt?${date.getTime()}`);
            this.env = JSON.parse(env);
            store.set('env', this.env);
        },

        async set_account() {
            try {
                let token = account_manager.get_token();
                if (token) {
                    this.account = await account_manager.get_account(token);
                    socket_service.start_websocket(this.account.token);
                }
            } catch (ex) {
                console.log(ex);
            }

            if (!this.account) {
                window.location.href = this.env.HORIZON_AUTH_FE_PUB_HTTP_URL;
            } else if (window.location.search !== '') {
                let h = window.location.href;
                window.location.href = h.substring(0, h.indexOf('?'));
            } else {
                this.loading = false;
            }
        },

        set_handlers() {
            this.$bus.$on('logout', async () => {
                let res = await account_manager.logout();
                window.location.href = this.env.HORIZON_AUTH_FE_PUB_HTTP_URL;
            });
        }
    }
};
</script>

<template>
    <div class="app">
        <layout v-if="account && !loading">
            <router-view slot="page_overlay" />
            <router-view slot="body" />
        </layout>
        <view-bus-container></view-bus-container>
        <div v-if="!account && !loading" class="load-error">
            There was an error loading the page. Are you logged in?
        </div>
        <div v-if="loading" class="app-loader">
            <i class="fa fa-sync fa-spin spinner"></i>
            <span class="loading-text">Loading Database...</span>
        </div>
    </div>
</template>
