<template>
	<div class="layout">
		<div class="header">
			<div class="left">
				<div class="logo">
					<img :src="logoSrc" />
					<div class="cover" v-if="activeIndex === '/'"></div>
				</div>
				<el-menu class="nav" ref="nav" mode="horizontal" @select="navSelected">
					<el-menu-item index="/" :class="{ 'is-active2': activeIndex === '/' }">
						<i class="menu-icon fa fa-table"></i>
						<span class="menu-text">Tables</span>
					</el-menu-item>
					<el-menu-item index="/api" :class="{ 'is-active2': activeIndex === '/api' }">
						<i class="menu-icon fa fa-file-code"></i>
						<span class="menu-text">Api</span>
					</el-menu-item>
					<el-menu-item
						index="/guide"
						:class="{ 'is-active2': activeIndex === '/guide' }"
					>
						<i class="menu-icon fa fa-file-alt"></i>
						<span class="menu-text">Guide</span>
					</el-menu-item>
					<el-menu-item
						index="/account"
						:class="{ 'is-active2': activeIndex === '/account' }"
					>
						<i class="menu-icon fa fa-user"></i>
						<span class="menu-text">Account</span>
					</el-menu-item>
				</el-menu>
			</div>
			<div class="right">
				<div class="header-text" v-if="account">
					<span>{{ account.email }}</span>
				</div>
				<div class="header-link" @click="contact">
					<i class="header-icon fa fa-user-edit"></i>
				</div>
				<div class="header-link" @click="logout">
					<i class="header-icon fa fa-sign-out-alt"></i>
				</div>
			</div>
		</div>
		<div class="body">
			<slot class="body-container" name="body">404 - Route not found</slot>
		</div>
	</div>
</template>

<script>
import { store } from '@/store';
import { ref, onMounted, onBeforeUnmount, watch, nextTick } from 'vue';
import { account_manager } from '@/core/context/account/account-manager';
import logoSrc from '@/assets/logo.svg';

export default {
	name: 'LayoutComponent',
	setup() {
		const account = ref(null);
		const activeIndex = ref(null);
		const submenuTimeout = ref(null);
		const nav = ref(null);

		const setActive = () => {
			let end = window.location.pathname.substring(1).indexOf('/');
			if (end > -1) {
				activeIndex.value = window.location.pathname.substring(0, end + 1);
			} else {
				activeIndex.value = window.location.pathname;
			}
		};

		const setupNavBehavior = async () => {
			await nextTick();

			document.body.classList.add('nav-popper-hidden');
			nav.value.$el.addEventListener('click', () => {
				document.body.classList.remove('nav-popper-hidden');
			});
			nav.value.$el.addEventListener('mouseenter', () => {
				clearTimeout(submenuTimeout.value);
			});
			document.querySelector('.nav-popper').addEventListener('mouseenter', () => {
				clearTimeout(submenuTimeout.value);
			});
			nav.value.$el.addEventListener('mouseleave', () => {
				submenuTimeout.value = setTimeout(() => {
					document.body.classList.add('nav-popper-hidden');
				}, 1500);
			});
			document.querySelector('.nav-popper').addEventListener('mouseleave', () => {
				submenuTimeout.value = setTimeout(() => {
					document.body.classList.add('nav-popper-hidden');
				}, 1500);
			});
		};

		const contact = () => {
			window.open(store.getters['env/HORIZON_AUTH_FE_PUB_HTTP_URL'] + '/contact', '_blank');
		};

		const logout = async () => {
			await account_manager.logout();
			window.location.href = store.getters['env/HORIZON_AUTH_FE_PUB_HTTP_URL'];
		};

		const navSelected = (e) => {
			if (e === window.location.pathname) return;
			window.location.href = e;
		};

		watch(() => window.location.pathname, setActive);

		onMounted(() => {
			store.subscribe('account', (a) => (account.value = a));
			setActive();
			// setupNavBehavior();
		});

		onBeforeUnmount(() => {
			document.body.classList.remove('nav-popper-hidden');
		});

		return {
			account,
			activeIndex,
			nav,
			logoSrc,
			contact,
			logout,
			navSelected,
		};
	},
};
</script>
