/**
 * Milestone 0 spike server. Deliberately dependency-free so it runs before any
 * npm install: node spike/server.mjs
 *
 * Serves the probe page at / and answers everything else with a loud JSON 404.
 * That 404 is itself a signal — if a request for /twitch-player/... lands here,
 * it means Discord's proxy did NOT apply a URL mapping for that prefix and fell
 * through to the root mapping instead.
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;

const server = createServer(async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;

  if (path === '/' || path === '/index.html') {
    const html = await readFile(join(here, 'index.html'));
    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
    });
    return res.end(html);
  }

  console.log(`[spike] unmapped request reached our server: ${req.method} ${path}`);
  res.writeHead(404, {
    'content-type': 'application/json',
    'cache-control': 'no-store',
  });
  res.end(
    JSON.stringify({
      reachedOurServer: true,
      path,
      hint: 'Discord did not apply a URL mapping for this prefix; it fell through to the root mapping.',
    }),
  );
});

server.listen(PORT, () => {
  console.log(`[spike] listening on http://localhost:${PORT}`);
  console.log('[spike] now run: cloudflared tunnel --url http://localhost:' + PORT);
});
