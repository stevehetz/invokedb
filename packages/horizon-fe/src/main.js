import { createApp } from 'vue';

// Element Plus (each area loads its own theme CSS; see router.js)
import ElementPlus from 'element-plus';

// App
import Root from '@/root.vue';
import router from '@/router';
import { iframe_manager } from '@/components/_iframe/iframe-manager';
import { bus } from '@/core/bus';

iframe_manager.init();

const app = createApp(Root);
app.config.globalProperties.$bus = bus;
app.use(ElementPlus);
app.use(router);
app.mount('#root');
