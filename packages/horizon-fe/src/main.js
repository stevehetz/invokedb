// Vue
import Vue from 'vue';

// ElementUI
import ElementUI from 'element-ui';
import lang from 'element-ui/lib/locale/lang/en';
import locale from 'element-ui/lib/locale';
import 'element-ui/lib/theme-chalk/index.css';

// Jqtree
import 'jqtree';
import 'jqtree/jqtree.css';

// AgGrid
import 'ag-grid-community/dist/styles/ag-grid.css';

// App
import './stylesheet.scss';
import App from '@/components/app.vue';
import router from '@/router';
import { iframe_manager } from '@/components/_iframe/iframe-manager';
import { bus } from '@/core/bus';

iframe_manager.init();
locale.use(lang);

Vue.prototype = Object.assign(Vue.prototype, {
    $bus: bus
});

Vue.config.productionTip = false;
Vue.config.devtools = false;
Vue.config.debug = false;
Vue.config.silent = true;

Vue.use(ElementUI);

new Vue({
    router,
    render: h => h(App)
}).$mount('#root');
