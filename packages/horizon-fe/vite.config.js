import path from 'node:path';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

// Chunk-size budgets, in kB of minified JS. Every chunk gets Vite's usual 500 kB, except ag-grid:
// its core is a single ~1 MB module (main.esm.mjs) that no chunking can split, even with only
// the grid's own modules registered (h-data-grid.js). It loads with the /app shell only. Vite's
// own warning is set to ag-grid's budget and chunk_budgets() checks the rest.
const CHUNK_BUDGET_KB = 500;
const CHUNK_BUDGETS_KB = { 'ag-grid': 1100 };

function chunk_budgets() {
    return {
        name: 'chunk-budgets',
        apply: 'build',
        generateBundle(_options, bundle) {
            for (const chunk of Object.values(bundle)) {
                if (chunk.type !== 'chunk') continue;
                const kb = Buffer.byteLength(chunk.code) / 1000;
                const budget = CHUNK_BUDGETS_KB[chunk.name] ?? CHUNK_BUDGET_KB;
                if (kb > budget) {
                    this.warn(
                        `Chunk ${chunk.fileName} is ${kb.toFixed(0)} kB, over its ` +
                            `${budget} kB budget (vite.config.js). Lazy-load or split it.`
                    );
                }
            }
        }
    };
}

// A codeSplitting `test` that matches the JS modules of the npm packages `is_pkg` accepts.
function vendor_test(is_pkg) {
    return id => {
        if (!/\.[cm]?js$/.test(id)) return false;
        const m = id.match(/node_modules[\\/]((?:@[^\\/]+[\\/])?[^\\/]+)/);
        return !!m && is_pkg(m[1].replace(/\\/g, '/'));
    };
}

// Env comes from scripts/env.sh (the repo .env); the browser gets its runtime env from
// public/env.txt, written by env.js.
export default defineConfig({
    plugins: [vue(), chunk_budgets()],
    resolve: {
        alias: { '@': path.resolve(__dirname, 'src') },
        // Components are imported as directories (`@/components/home` -> home/index.vue)
        extensions: ['.mjs', '.js', '.json', '.vue']
    },
    build: {
        chunkSizeWarningLimit: Math.max(
            CHUNK_BUDGET_KB,
            ...Object.values(CHUNK_BUDGETS_KB)
        ),
        rolldownOptions: {
            output: {
                // The big libraries get chunks of their own, so they're cached across deploys.
                // JS only: CSS must stay with the shell that imports it (see router.js).
                // A group also takes in its modules' dependencies, so Vue has the highest
                // priority and claims its modules first. Otherwise ag-grid-vue3 pulls the Vue
                // runtime into the ag-grid chunk, and the entry (every page, the public site
                // too) has to load all of ag-grid statically just to get Vue (#131).
                codeSplitting: {
                    groups: [
                        {
                            name: 'vue',
                            test: vendor_test(
                                pkg =>
                                    pkg === 'vue' ||
                                    pkg === 'vue-router' ||
                                    pkg.startsWith('@vue/')
                            ),
                            priority: 3
                        },
                        {
                            name: 'element-plus',
                            test: vendor_test(
                                pkg =>
                                    pkg === 'element-plus' ||
                                    pkg.startsWith('@element-plus/')
                            ),
                            priority: 2
                        },
                        {
                            name: 'ag-grid',
                            test: vendor_test(
                                pkg =>
                                    pkg.startsWith('ag-grid-') ||
                                    pkg === 'ag-stack'
                            ),
                            priority: 1
                        }
                    ]
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
