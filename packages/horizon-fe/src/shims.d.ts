// Lets `tsc -p jsconfig.json` (npm run typecheck) resolve imports it can't read itself.
declare module '*.vue' {
    import type { DefineComponent } from 'vue';
    const component: DefineComponent<{}, {}, any>;
    export default component;
}
