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
