import { createApp } from 'vue';

// The only global CSS outside the two shells (see router.js): both areas use these.
// Font Awesome and highlight.js only style their own classes (`fa*`, `hljs*`). Font Awesome is
// also the loading spinner in index.html. They were CDN links in index.html.
import '@fortawesome/fontawesome-free/css/all.css';
// highlight.js 11 moved the dark Atelier Plateau theme to `styles/base16/`.
import 'highlight.js/styles/base16/atelier-plateau.css';
// Element Plus's default theme, for both areas. It's here, in the entry chunk, so it always
// comes before the areas' own CSS. The app area overrides its colours (element-theme.scss).
import 'element-plus/dist/index.css';

// Element Plus. Only the components the
// templates use are registered, each imported from its own module: importing from
// 'element-plus' itself keeps the whole library in the bundle (its index reads the all-in-one
// installer at load time, so nothing can be tree-shaken). Using a new `<el-*>` component means
// adding it here (an unregistered one renders as an inert unknown element, with no warning in
// production); a parent (ElMenu, ElForm, ElTabs, ElSelect, ElCarousel, ElRadio, ElDropdown)
// registers its children too. ElLoading is the `v-loading` directive.
import ElButton from 'element-plus/es/components/button/index.mjs';
import ElCarousel from 'element-plus/es/components/carousel/index.mjs';
import ElDialog from 'element-plus/es/components/dialog/index.mjs';
import ElDropdown from 'element-plus/es/components/dropdown/index.mjs';
import ElForm from 'element-plus/es/components/form/index.mjs';
import ElInput from 'element-plus/es/components/input/index.mjs';
import ElLoading from 'element-plus/es/components/loading/index.mjs';
import ElMenu from 'element-plus/es/components/menu/index.mjs';
import ElProgress from 'element-plus/es/components/progress/index.mjs';
import ElRadio from 'element-plus/es/components/radio/index.mjs';
import ElSelect from 'element-plus/es/components/select/index.mjs';
import ElTabs from 'element-plus/es/components/tabs/index.mjs';
import ElTooltip from 'element-plus/es/components/tooltip/index.mjs';
import ElTree from 'element-plus/es/components/tree/index.mjs';
import ElUpload from 'element-plus/es/components/upload/index.mjs';

// App
import Root from '@/root.vue';
import router from '@/router';
import { iframe_manager } from '@/components/_iframe/iframe-manager';
import { bus } from '@/core/bus';

iframe_manager.init();

const app = createApp(Root);
app.config.globalProperties.$bus = bus;
[
    ElButton,
    ElCarousel,
    ElDialog,
    ElDropdown,
    ElForm,
    ElInput,
    ElLoading,
    ElMenu,
    ElProgress,
    ElRadio,
    ElSelect,
    ElTabs,
    ElTooltip,
    ElTree,
    ElUpload
].forEach(plugin => app.use(plugin));
app.use(router);
app.mount('#root');
