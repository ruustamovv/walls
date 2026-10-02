import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The browser E2E harness runs the backend on a fixed port and points Vite's
// proxy at it, so override the target (and dev port) from the environment.
const apiTarget = process.env['VITE_PROXY_TARGET'] ?? 'http://localhost:3000';
const port = Number(process.env['VITE_PORT'] ?? 5173);

export default defineConfig({
  plugins: [react()],
  server: {
    port,
    strictPort: true,
    proxy: {
      '/api': { target: apiTarget, changeOrigin: true },
      '/socket': { target: apiTarget, ws: true, changeOrigin: true },
    },
  },
  build: { outDir: 'dist', sourcemap: true },
});