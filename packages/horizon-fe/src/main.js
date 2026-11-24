import { createApp } from 'vue';

// The only global CSS outside the two shells (see router.js): both areas use these, and they
// only style their own classes (`fa*`, `hljs*`), so they can't clash with either area's CSS.
// Font Awesome is also the loading spinner in index.html. They were CDN links in index.html.
import '@fortawesome/fontawesome-free/css/all.css';
import 'highlight.js/styles/atelier-plateau-dark.css';

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
