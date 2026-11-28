<script>
// The signed-in app's shell (route /app). It owns the app's global CSS, scoped to
// <html class="app-area">, including its Element Plus colours; see router.js.
import '@/app-area.scss';

import ViewBusContainer from '@/components/view-bus/view-bus-container';
import Layout from '@/components/layout';
import PlanLimitNotice from '@/components/plan-limit-notice';
import { store } from '@/store';
import { account_manager } from '@/core/context/account/account-manager';
import { socket_service } from '@/core/ws/socket-service';
import { sync_account_theme } from '@/core/theme';

// Back in the tab after at least this long away, the session is checked (#378)
const AWAY_CHECK_MS = 5 * 60 * 1000;

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
        'view-bus-container': ViewBusContainer,
        'plan-limit-notice': PlanLimitNotice
    },

    async created() {
        this.$bus.$on('logout', this.logout);
        this.$bus.$on('session:unauthorized', this.check_session);
        document.addEventListener('visibilitychange', this.visibility_changed);
        this.hidden_at = document.hidden ? Date.now() : null;
        this.checking_session = false;
        this.env = store.get('env');
        await this.set_account();
    },

    beforeUnmount() {
        // Links to the public site use the router, so the shell can unmount and come back
        this.$bus.$off('logout', this.logout);
        this.$bus.$off('session:unauthorized', this.check_session);
        document.removeEventListener(
            'visibilitychange',
            this.visibility_changed
        );
    },

    methods: {
        // A session can end while the tab is in the background (#378): back after a while,
        // check it, so a dead session goes to sign in instead of a page whose requests fail
        visibility_changed() {
            if (document.hidden) {
                this.hidden_at = Date.now();
                return;
            }
            const away = this.hidden_at ? Date.now() - this.hidden_at : 0;
            this.hidden_at = null;
            if (away >= AWAY_CHECK_MS) this.check_session();
        },

        // After a refused request or a long time away: if the server says the session is
        // over, sign in again (a full page load, like logout, drops the account's data and
        // the websocket). A failed check (offline) changes nothing.
        async check_session() {
            if (!this.account || this.checking_session) return;
            this.checking_session = true;
            try {
                if (await account_manager.session_ended()) {
                    account_manager.end_local_session();
                    window.location.href = '/login';
                    return;
                }
            } catch (ex) {
                // The server can't be reached: keep the page as it is
            }
            this.checking_session = false;
        },

        async set_account() {
            try {
                let token = account_manager.get_token();
                if (token) {
                    this.account = await account_manager.get_account(token);
                    // The account's light/dark choice (#290), saved from any device
                    sync_account_theme(this.account.theme);
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
        <plan-limit-notice v-if="account && !loading"></plan-limit-notice>
        <div v-if="!account && !loading" class="load-error">
            There was an error loading the page. Are you logged in?
        </div>
        <div v-if="loading" class="app-loader">
            <i class="fa fa-sync fa-spin spinner"></i>
            <span class="loading-text">Loading Database...</span>
        </div>
    </div>
</template>
