<script>
// The signed-in app's shell (route /app). It owns the app's global CSS, scoped to
// <html class="app-area">, including its Element Plus colours; see router.js.
import '@/app-area.scss';

import ViewBusContainer from '@/components/view-bus/view-bus-container';
import Layout from '@/components/layout';
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
        this.$bus.$on('logout', this.logout);
        this.env = store.get('env');
        await this.set_account();
    },

    beforeUnmount() {
        // Links to the public site use the router, so the shell can unmount and come back
        this.$bus.$off('logout', this.logout);
    },

    methods: {
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
                this.$router.replace('/login');
            } else {
                this.loading = false;
            }
        },

        async logout() {
            await account_manager.logout();
            // A full page load on purpose: it drops everything the app holds in memory for
            // this account and closes the websocket
            window.location.href = '/';
        }
    }
};
</script>

<template>
    <div class="app">
        <layout v-if="account && !loading">
            <template #body>
                <router-view />
            </template>
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
