import express from 'express';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { env } from './env.js';
import { authRouter } from './routes/auth.js';
import { startMetadataPolling } from './rooms.js';
import { attachWebSocketServer } from './ws.js';

const here = dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(express.json({ limit: '16kb' }));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

app.use('/api', authRouter);

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
  console.log(`[server] OAuth redirect: ${env.publicBaseUrl}/api/auth/callback`);
  console.log('[server]   ^ this must be registered in the Discord developer portal');
});
