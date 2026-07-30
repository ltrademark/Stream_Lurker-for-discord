/**
 * Milestone 0 spike server. Dependency-free: node spike/server.mjs
 *
 * Serves:
 *   /                  the probe page
 *   /twitch-embed?…    the player HTML, fetched from Twitch and rewritten so
 *                      every absolute asset URL points at a Discord proxy path
 *   /twitch-shim.js    the runtime shim injected into that document
 *   anything else      a loud JSON 404, which is itself a signal — a request
 *                      landing here means Discord applied no URL mapping for
 *                      that prefix and fell through to the root mapping
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { rewriteCss, rewriteHtml, shimSource } from './rewrite.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/140.0.0.0 Safari/537.36';

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const path = url.pathname;

  if (path === '/' || path === '/index.html') {
    const html = await readFile(join(here, 'index.html'));
    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
    });
    return res.end(html);
  }

  if (path === '/twitch-shim.js') {
    res.writeHead(200, {
      'content-type': 'application/javascript; charset=utf-8',
      'cache-control': 'no-store',
    });
    return res.end(shimSource());
  }

  if (path === '/twitch-embed') {
    return serveEmbed(url, req, res);
  }

  if (path === '/twitch-css') {
    return serveCss(url, req, res);
  }

  console.log(`[spike] unmapped request reached our server: ${req.method} ${path}`);

  // A request for a Twitch prefix landing here means Discord has no URL mapping
  // for it. Rather than a silent 404, answer scripts with a tiny module that
  // reports the missing prefix to the spike page — a missing mapping then names
  // itself in the log instead of looking like a Twitch failure.
  const prefix = `/${path.split('/')[1] ?? ''}`;
  if (TWITCH_PREFIXES.has(prefix) && path.endsWith('.js')) {
    res.writeHead(200, {
      'content-type': 'application/javascript; charset=utf-8',
      'cache-control': 'no-store',
    });
    return res.end(
      `(function(){try{parent.postMessage({__spike:true,kind:'mapping',` +
        `detail:${JSON.stringify(prefix)}},'*')}catch(e){}})();`,
    );
  }

  res.writeHead(404, {
    'content-type': 'application/json',
    'cache-control': 'no-store',
  });
  res.end(
    JSON.stringify({
      reachedOurServer: true,
      path,
      hint: 'Discord applied no URL mapping for this prefix; it fell through to the root mapping.',
    }),
  );
});

/** Prefixes that must be configured as URL Mappings in the Developer Portal. */
const TWITCH_PREFIXES = new Set([
  '/twitch-assets',
  '/twitch-player',
  '/twitch-gql',
  '/twitch-usher',
  '/twitch-spade',
  '/twitch-cdn',
  '/ttvnw',
  '/tw',
  '/jtv',
  '/twitchcdn',
]);

/**
 * Fetches Twitch's player page and rewrites its absolute URLs to proxy paths.
 *
 * Only this HTML travels through us — roughly 185 KB, once. Every script and
 * video segment it then loads goes via Discord's own URL mappings, so the host
 * machine's upload is not carrying anyone's stream.
 */
async function serveEmbed(url, req, res) {
  const upstream = new URL('https://player.twitch.tv/');
  // Pass the caller's parameters through verbatim: channel, parent (repeated),
  // muted, autoplay. Twitch validates parent against the real ancestor origins,
  // so it has to be the client's list, not something we invent.
  for (const [key, value] of url.searchParams) {
    upstream.searchParams.append(key, value);
  }

  console.log(`[spike] embed -> ${upstream}`);

  try {
    const twitch = await fetch(upstream, {
      headers: {
        'user-agent': req.headers['user-agent'] ?? UA,
        'accept-language': req.headers['accept-language'] ?? 'en-US,en;q=0.9',
        accept: 'text/html,application/xhtml+xml',
      },
    });

    if (!twitch.ok) {
      res.writeHead(502, { 'content-type': 'text/plain' });
      return res.end(`Twitch returned ${twitch.status} for the player page.`);
    }

    const original = await twitch.text();
    let html = rewriteHtml(original);

    // Two things must go in before any of Twitch's own code runs.
    //
    // <base> first, and this one is easy to miss: we serve this document at
    // /.proxy/twitch-embed, but it was authored to live at player.twitch.tv/.
    // Every relative URL in it — Kasada's fp and mfc endpoints among them —
    // would otherwise resolve against /.proxy/ and fall through to this server
    // as a 404. Pointing base at the mapped player prefix restores the
    // resolution Twitch's code expects.
    //
    // Then the shim, so it patches fetch/XHR/src before anything uses them.
    // Its own src is root-relative, so <base> does not affect it.
    // The marker inline script proves whether inline execution works at all in
    // here. Discord's CSP carries a nonce and no 'unsafe-inline', so Twitch's
    // own un-nonced inline scripts may be dropped without a trace.
    const inject =
      `<base href="/.proxy/twitch-player/">` +
      `<script src="/.proxy/twitch-shim.js"></script>` +
      `<script>window.__spikeInlineRan=true</script>`;
    if (/<head[^>]*>/i.test(html)) {
      html = html.replace(/<head([^>]*)>/i, `<head$1>${inject}`);
    } else {
      html = inject + html;
    }

    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
    });
    res.end(html);

    console.log(
      `[spike] embed served: ${original.length} -> ${html.length} bytes, ` +
        `${countRewrites(original)} absolute Twitch URLs rewritten`,
    );
  } catch (err) {
    console.error('[spike] embed failed:', err);
    res.writeHead(502, { 'content-type': 'text/plain' });
    res.end(`Could not fetch the Twitch player page: ${err.message}`);
  }
}

/**
 * Fetches one of Twitch's stylesheets and rewrites the absolute URLs inside it.
 * Only reachable for assets.twitch.tv CSS, so this can't be used as an open
 * proxy for arbitrary hosts.
 */
async function serveCss(url, req, res) {
  const target = url.searchParams.get('u') ?? '';

  if (!/^https:\/\/assets\.twitch\.tv\/[^\s]+\.css$/i.test(target)) {
    res.writeHead(400, { 'content-type': 'text/plain' });
    return res.end('Only assets.twitch.tv stylesheets may be proxied.');
  }

  try {
    const upstream = await fetch(target, {
      headers: { 'user-agent': req.headers['user-agent'] ?? UA },
    });
    if (!upstream.ok) {
      res.writeHead(502, { 'content-type': 'text/plain' });
      return res.end(`Twitch returned ${upstream.status} for that stylesheet.`);
    }

    const css = rewriteCss(await upstream.text());
    res.writeHead(200, {
      'content-type': 'text/css; charset=utf-8',
      'cache-control': 'no-store',
    });
    res.end(css);
    console.log(`[spike] css rewritten: ${target.split('/').pop()} (${css.length} bytes)`);
  } catch (err) {
    console.error('[spike] css proxy failed:', err);
    res.writeHead(502, { 'content-type': 'text/plain' });
    res.end(`Could not fetch that stylesheet: ${err.message}`);
  }
}

function countRewrites(html) {
  const matches = html.match(/https:\/\/[a-z0-9-]+\.(twitch\.tv|ttvnw\.net|jtvnw\.net)/gi);
  return matches ? matches.length : 0;
}

server.listen(PORT, () => {
  console.log(`[spike] listening on http://localhost:${PORT}`);
  console.log(`[spike] tunnel it:  cloudflared tunnel --url http://localhost:${PORT}`);
});
