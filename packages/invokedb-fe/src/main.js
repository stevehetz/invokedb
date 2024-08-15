// Vue
import { createApp } from 'vue'

// Element Plus
import ElementPlus from 'element-plus';
import 'element-plus/dist/index.css';

// jqTree
import 'jqtree';
import 'jqtree/jqtree.css';

// ag-Grid
import 'ag-grid-community/styles/ag-grid.css';

// App
import './stylesheet.scss';
import App from '@/App.vue';
import router from '@/router';
import { iframe_manager } from '@/components/_iframe/iframe-manager';

// Initialize iframe manager
iframe_manager.init();

// Create the Vue app
const app = createApp(App)

// Use Element Plus
app.use(ElementPlus);

// Use the router
app.use(router);

// Mount the Vue app
app.mount('#app');
