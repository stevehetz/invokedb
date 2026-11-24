import path from 'node:path';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

// Env comes from scripts/env.sh (the repo .env); the browser gets its runtime env from
// public/env.txt, written by env.js.
export default defineConfig({
    plugins: [vue()],
    resolve: {
        alias: { '@': path.resolve(__dirname, 'src') },
        // Components are imported as directories (`@/components/home` -> home/index.vue)
        extensions: ['.mjs', '.js', '.json', '.vue']
    },
    css: {
        preprocessorOptions: {
            // Element Plus's theme SCSS is still written with `@import`-era globals
            scss: {
                quietDeps: true,
                silenceDeprecations: ['import', 'global-builtin']
            }
        }
    },
    build: {
        rollupOptions: {
            output: {
                // The big libraries get chunks of their own, so they're cached across deploys.
                // JS only: CSS must stay with the shell that imports it (see router.js).
                manualChunks(id) {
                    if (!/\.[cm]?js$/.test(id)) return;
                    const m = id.match(/node_modules\/((?:@[^/]+\/)?[^/]+)/);
                    if (!m) return;
                    const pkg = m[1];
                    if (pkg.startsWith('ag-grid-')) return 'ag-grid';
                    if (
                        pkg === 'element-plus' ||
                        pkg.startsWith('@element-plus/')
                    )
                        return 'element-plus';
                    if (
                        pkg === 'vue' ||
                        pkg === 'vue-router' ||
                        pkg.startsWith('@vue/')
                    )
                        return 'vue';
                }
            }
        }
    },
    server: {
        host: '0.0.0.0',
        port: Number(process.env.HORIZON_FE_PUB_HTTP_PORT) || 8000,
        strictPort: true
    },
    preview: {
        host: '0.0.0.0',
        port: Number(process.env.HORIZON_FE_PUB_HTTP_PORT) || 8000,
        strictPort: true
    }
});
