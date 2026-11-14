<script>
// The signed-in app's shell (route /app). It owns the app's global CSS; see router.js for why.
// No 'element-ui/lib/theme-chalk/index.css' here: stylesheet.scss compiles the whole Element theme
// (with the app's colours) itself. Importing both put the default theme in a shared chunk that
// Vite's production build loaded after stylesheet.scss, overriding the app's nav styles.
import '@/core/jquery-global'; // must come before jqtree
import 'jqtree';
import 'jqtree/jqtree.css';
import 'ag-grid-community/dist/styles/ag-grid.css';
import '@/stylesheet.scss';

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
        this.env = store.get('env');
        await this.set_account();
        this.set_handlers();
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
                window.location.href = '/login'; // the public site: a full page load
            } else {
                this.loading = false;
            }
        },

        set_handlers() {
            this.$bus.$on('logout', async () => {
                await account_manager.logout();
                window.location.href = '/';
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
