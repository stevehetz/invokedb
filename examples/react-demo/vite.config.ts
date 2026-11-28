import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Served at https://examples.invokedb.com/react-demo/ by server/index.mjs. In development,
// `npm run server` (port 8080) answers the API, the webhook and the feed; Vite proxies to it.
export default defineConfig({
  base: '/react-demo/',
  plugins: [react()],
  resolve: {
    alias: {
      // The invokedb client from this repo, as source (like the Angular example)
      invokedb: fileURLToPath(new URL('../invokedb-node/src/index.ts', import.meta.url))
    }
  },
  server: {
    port: 5174,
    proxy: {
      '/react-demo/api': 'http://127.0.0.1:8080',
      '/react-demo/events': 'http://127.0.0.1:8080',
      '/react-demo/webhook': 'http://127.0.0.1:8080'
    }
  }
});
