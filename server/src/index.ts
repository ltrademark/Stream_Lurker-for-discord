import express from 'express';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { env } from './env.js';
import { tokenRouter } from './routes/token.js';
import { startMetadataPolling } from './rooms.js';
import { attachWebSocketServer } from './ws.js';

const here = dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(express.json({ limit: '16kb' }));

/**
 * Discord's docs are inconsistent about whether activity requests carry the
 * /.proxy prefix — the current guide shows bare paths, older material and the
 * community tooling both use /.proxy. Stripping it here means the same routes
 * answer either spelling, so the answer stops mattering.
 */
app.use((req, _res, next) => {
  if (req.url.startsWith('/.proxy/')) req.url = req.url.slice('/.proxy'.length);
  next();
});

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

app.use('/api', tokenRouter);

// Serve the built client in production; in dev, Vite serves it on its own port.
const clientDist = join(here, '../../client/dist');
if (existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get('*splat', (_req, res) => {
    res.sendFile(join(clientDist, 'index.html'));
  });
} else if (env.isProduction) {
  console.warn('  client/dist is missing — run npm run build before starting.');
}

const server = createServer(app);
attachWebSocketServer(server);
startMetadataPolling();

server.listen(env.port, () => {
  console.log(`[server] listening on http://localhost:${env.port}`);
  if (!env.isProduction) {
    console.log(`[server] tunnel it:  cloudflared tunnel --url http://localhost:${env.port}`);
  }
});
