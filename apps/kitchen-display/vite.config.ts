import { tenantPwa } from '../../packages/ui/server/pwa-vite.js';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [tenantPwa('kitchen'), react()],
  server: {
    proxy: {
      '/api': process.env.API_PROXY_TARGET ?? 'http://127.0.0.1:3000',
      '/socket.io': { target: process.env.API_PROXY_TARGET ?? 'http://127.0.0.1:3000', ws: true },
    },
  },
  build: { outDir: 'dist' },
});
