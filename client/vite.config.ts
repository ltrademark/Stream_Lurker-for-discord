import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Vite serves the client on 5173 and forwards /api and /ws to the Node server
 * on 3000, so dev runs entirely on http://localhost:5173 — Twitch accepts
 * localhost as an embed parent, so no tunnel is needed.
 */
export default defineConfig({
  plugins: [react()],
  // .env lives at the repo root, shared with the server.
  envDir: '..',
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: false },
      '/ws': { target: 'ws://localhost:3000', ws: true },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
