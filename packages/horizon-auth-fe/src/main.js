// Vue
import Vue from 'vue';

// ElementUI
import ElementUI from 'element-ui';
import lang from 'element-ui/lib/locale/lang/en';
import locale from 'element-ui/lib/locale';
import 'element-ui/lib/theme-chalk/index.css';

// App
import App from './view/app.vue';
import router from './view/router';
import './view/stylesheet.scss';

locale.use(lang);

Vue.config.productionTip = false;
Vue.config.devtools = false;
Vue.config.debug = false;
Vue.config.silent = true;

Vue.use(ElementUI);

new Vue({
    router,
    render: h => h(App)
}).$mount('#root');
