import { tenantPwa } from '../../packages/ui/server/pwa-vite.js';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [tenantPwa('waiter'), react()],
  server: {
    proxy: {
      '/api': { target: process.env.API_PROXY_TARGET ?? 'http://127.0.0.1:3000', xfwd: true },
      '/socket.io': {
        target: process.env.API_PROXY_TARGET ?? 'http://127.0.0.1:3000',
        ws: true,
        xfwd: true,
      },
    },
  },
  build: { outDir: 'dist' },
});
