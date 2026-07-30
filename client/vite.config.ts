import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * In dev you tunnel THIS server (5173), not the API server — that keeps HMR
 * working through the tunnel. Vite forwards /api and /ws to the Node server on
 * 3000, tolerating the /.proxy prefix either way.
 *
 * Set TUNNEL=1 when running behind cloudflared so HMR dials wss://<host>:443
 * instead of ws://localhost:5173.
 */
const tunnelled = process.env.TUNNEL === '1';

export default defineConfig({
  plugins: [react()],
  // .env lives at the repo root, shared with the server.
  envDir: '..',
  server: {
    port: 5173,
    // cloudflared hands out a random *.trycloudflare.com hostname each run.
    allowedHosts: true,
    proxy: {
      '^/(\\.proxy/)?api': {
        target: 'http://localhost:3000',
        changeOrigin: false,
      },
      '^/(\\.proxy/)?ws': {
        target: 'ws://localhost:3000',
        ws: true,
      },
    },
    ...(tunnelled ? { hmr: { protocol: 'wss', clientPort: 443 } } : {}),
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
