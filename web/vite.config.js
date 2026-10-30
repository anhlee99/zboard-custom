import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const api = 'http://localhost:' + (process.env.PORT || 3000);

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/api': { target: api, changeOrigin: false },
      '/files': { target: api, changeOrigin: false },
    },
  },
  build: { outDir: 'dist', emptyOutDir: true },
});
