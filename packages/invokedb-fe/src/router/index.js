import { createRouter, createWebHistory } from 'vue-router';
import Home from '@/components/home/index.vue';
// import Account from '@/components/account';
import Docs from '@/components/docs/index.vue';
// import Guide from '@/components/guide';
import { toggle_page_overlay } from '@/components/_page/page-overlay';
import { nextTick } from 'vue';

const routes = [
	{
		path: '/',
		component: Home,
		children: [
			// Uncomment and adjust the following if needed
			// {
			//     path: '/manage',
			//     name: 'manage',
			//     components: {
			//         page_overlay: Manage
			//     },
			//     children: [
			//         {
			//             path: 'api',
			//             name: 'api',
			//             component: Api
			//         },
			//         {
			//             path: 'trash',
			//             name: 'trash',
			//             component: Trash
			//         }
			//     ]
			// },
			// {
			//     path: '/account',
			//     name: 'account',
			//     components: {
			//         page_overlay: Account
			//     }
			// },
			{
				path: '/api',
				name: 'api',
				components: {
					page_overlay: Docs,
				},
			},
			// {
			//     path: '/guide',
			//     name: 'guide',
			//     components: {
			//         page_overlay: Guide
			//     }
			// }
		],
	},
	{
		path: '/:pathMatch(.*)*',
		redirect: { name: 'home' },
	},
];

const router = createRouter({
	history: createWebHistory('/'),
	routes,
});

router.afterEach((to) => {
	const checkOverlay = setInterval(() => {
		const overlay = document.querySelector('.page-overlay');
		if (overlay) {
			clearInterval(checkOverlay);
			toggle_page_overlay(to.path);
		}
	}, 100);
});

export default router;
