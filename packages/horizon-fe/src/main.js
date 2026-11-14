// Vue
import Vue from 'vue';

// ElementUI (each area loads its own theme CSS; see router.js)
import ElementUI from 'element-ui';
import lang from 'element-ui/lib/locale/lang/en';
import locale from 'element-ui/lib/locale';

// App
import Root from '@/root.vue';
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
    render: h => h(Root)
}).$mount('#root');
