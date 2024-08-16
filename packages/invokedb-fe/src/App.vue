<script>
import { ref, onMounted } from 'vue';
// import ViewBusContainer from '@/components/view-bus/view-bus-container';
import LayoutComponent from '@/components/Layout.vue';
import { http } from '@/core/http';
import { store } from '@/store';
import { account_manager } from '@/core/context/account/account-manager';
import { socket_service } from '@/core/ws/socket-service';
import { bus } from '@/core/bus';

export default {
	name: 'App',
	components: {
		LayoutComponent,
	},
	setup() {
		const loading = ref(true);
		const env = ref(null);
		const account = ref(null);

		const setEnv = async () => {
			const date = new Date();
			const envData = await fetch(`/env.json?${date.getTime()}`);
			env.value = await envData.json();
			store.set('env', env.value);
		};

		const setAccount = async () => {
			// mock account
			account.value = {
				email: 'test@gmail.com',
				token: 'test_token',
				user_id: 'test_user_id',
			};

			// Uncomment this block if you want to use actual account retrieval logic
			try {
				const token = account_manager.get_token();
				if (token) {
					account.value = await account_manager.get_account(token);
					socket_service.start_websocket(account.value.token);
				}
			} catch (ex) {
				console.log(ex);
			}

			if (!account.value) {
				window.location.href = this.env.HORIZON_AUTH_FE_PUB_HTTP_URL;
			} else if (window.location.search !== '') {
				let h = window.location.href;
				window.location.href = h.substring(0, h.indexOf('?'));
			} else {
				loading.value = false;
			}
		};

		const setHandlers = () => {
			// If you need to handle events, you can register them here
			bus.on('logout', async () => {
				await account_manager.logout();
				window.location.href = env.value.HORIZON_AUTH_FE_PUB_HTTP_URL;
			});
		};

		onMounted(async () => {
			await setEnv();
			await setAccount();
			setHandlers();
		});

		return {
			loading,
			env,
			account,
		};
	},
};
</script>

<template>
	<div class="app">
		<LayoutComponent v-if="account && !loading">
			<template v-slot:page_overlay>
				<router-view name="page_overlay"></router-view>
			</template>
			<template v-slot:body>
				<router-view></router-view>
			</template>
		</LayoutComponent>
		<!-- <view-bus-container></view-bus-container> -->
		<div v-if="!account && !loading" class="load-error">
			There was an error loading the page. Are you logged in?
		</div>
		<div v-if="loading" class="app-loader">
			<i class="fa fa-sync fa-spin spinner"></i>
			<span class="loading-text">Loading Database...</span>
		</div>
	</div>
</template>
