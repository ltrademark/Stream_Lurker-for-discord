/**
 * URL rewriting shared by the server-side embed proxy and the runtime shim
 * injected into the player document.
 *
 * Why this exists: Discord's activity CSP only permits requests to your own
 * proxy origin. Twitch's player page references its code at absolute URLs on
 * assets.twitch.tv, and the browser parses those <script> tags before any of
 * our JavaScript can run — so they must be rewritten in the HTML itself,
 * server-side, before the document ever reaches the browser.
 *
 * Nothing here strips or alters Twitch's behaviour. Their player code runs
 * unmodified: ads play, and telemetry still reaches spade.twitch.tv through the
 * mapped prefix. This only changes the hostname a request travels through so it
 * can traverse Discord's proxy.
 */

/** Exact-host rewrites, longest host first so prefixes don't shadow. */
export const HOST_MAP = [
  ['https://player.twitch.tv', '/.proxy/twitch-player'],
  ['https://assets.twitch.tv', '/.proxy/twitch-assets'],
  ['https://static-cdn.jtvnw.net', '/.proxy/twitch-cdn'],
  ['https://usher.ttvnw.net', '/.proxy/twitch-usher'],
  ['https://spade.twitch.tv', '/.proxy/twitch-spade'],
  ['https://gql.twitch.tv', '/.proxy/twitch-gql'],
];

/**
 * Wildcard fallbacks for hosts the player reaches at runtime that we haven't
 * enumerated — countess, trowel, client-event-reporter, and the rotating
 * video-weaver segment hosts.
 */
export const WILDCARDS = [
  [/^https:\/\/([a-z0-9-]+(?:\.[a-z0-9-]+)*)\.ttvnw\.net/i, '/.proxy/ttvnw/$1'],
  [/^https:\/\/([a-z0-9-]+)\.jtvnw\.net/i, '/.proxy/jtv/$1'],
  // k.twitchcdn.net serves Kasada bot detection. Twitch gates playback on it,
  // so blocking it is not cosmetic.
  [/^https:\/\/([a-z0-9-]+)\.twitchcdn\.net/i, '/.proxy/twitchcdn/$1'],
  // www/m/passport are human-facing pages, not assets. Proxying them would
  // send "watch on Twitch" clicks into the sandbox instead of a real browser.
  [/^https:\/\/(?!www\.|m\.|passport\.)([a-z0-9-]+)\.twitch\.tv/i, '/.proxy/tw/$1'],
];

/** Rewrites a single absolute URL. Returns it unchanged if nothing matches. */
export function rewriteUrl(url) {
  if (typeof url !== 'string') return url;

  for (const [from, to] of HOST_MAP) {
    if (url.startsWith(from)) return to + url.slice(from.length);
  }
  for (const [re, to] of WILDCARDS) {
    const match = url.match(re);
    if (match) return url.replace(re, to.replace('$1', match[1]));
  }
  return url;
}

/**
 * Rewrites every absolute Twitch URL in an HTML document. Deliberately a blunt
 * string replace rather than a parse: the URLs appear in attributes, inline
 * JSON, and inline scripts alike, and all of them need the same treatment.
 *
 * Order matters — the exact hosts run before the wildcards, or /tw/{sub} would
 * swallow assets.twitch.tv and gql.twitch.tv first.
 */
export function rewriteHtml(html) {
  let out = html;

  // Stylesheets have to detour through us before the host rewriting below, or
  // they'd go straight to Twitch via the mapping and their @font-face rules —
  // which hold absolute assets.twitch.tv URLs that no JavaScript can intercept
  // — would stay unrewritten and every font would be CSP-blocked.
  out = out.replace(
    /href="(https:\/\/assets\.twitch\.tv\/[^"]+\.css)"/gi,
    (_match, url) => `href="/.proxy/twitch-css?u=${encodeURIComponent(url)}"`,
  );

  for (const [from, to] of HOST_MAP) {
    out = out.split(from).join(to);
  }

  out = out
    .replace(/https:\/\/([a-z0-9-]+(?:\.[a-z0-9-]+)*)\.ttvnw\.net/gi, '/.proxy/ttvnw/$1')
    .replace(/https:\/\/([a-z0-9-]+)\.jtvnw\.net/gi, '/.proxy/jtv/$1')
    .replace(/https:\/\/([a-z0-9-]+)\.twitchcdn\.net/gi, '/.proxy/twitchcdn/$1')
    // Skip www/m/passport: those are human-facing links, not assets, and
    // rewriting them would send "watch on Twitch" clicks into the proxy.
    .replace(/https:\/\/(?!www\.|m\.|passport\.)([a-z0-9-]+)\.twitch\.tv/gi, '/.proxy/tw/$1');

  return out;
}

/**
 * Rewrites absolute URLs inside a CSS file — @font-face sources and
 * background images. Same host table as the HTML path.
 */
export function rewriteCss(css) {
  let out = css;
  for (const [from, to] of HOST_MAP) {
    out = out.split(from).join(to);
  }
  return out
    .replace(/https:\/\/assets\.twitch\.tv/gi, '/.proxy/twitch-assets')
    .replace(/https:\/\/([a-z0-9-]+(?:\.[a-z0-9-]+)*)\.ttvnw\.net/gi, '/.proxy/ttvnw/$1')
    .replace(/https:\/\/([a-z0-9-]+)\.jtvnw\.net/gi, '/.proxy/jtv/$1')
    .replace(/https:\/\/([a-z0-9-]+)\.twitchcdn\.net/gi, '/.proxy/twitchcdn/$1');
}

/**
 * The runtime shim, injected as the first script in <head>. Catches URLs the
 * player builds at execution time, which no amount of HTML rewriting can reach.
 * Returned as source text because it has to run inside the player document.
 */
export function shimSource() {
  return `(function () {
  var HOST_MAP = ${JSON.stringify(HOST_MAP)};
  var WILDCARDS = [
    [/^https:\\/\\/([a-z0-9-]+(?:\\.[a-z0-9-]+)*)\\.ttvnw\\.net/i, '/.proxy/ttvnw/'],
    [/^https:\\/\\/([a-z0-9-]+)\\.jtvnw\\.net/i, '/.proxy/jtv/'],
    [/^https:\\/\\/(?!www\\.|m\\.|passport\\.)([a-z0-9-]+)\\.twitch\\.tv/i, '/.proxy/tw/']
  ];

  function rw(url) {
    if (typeof url !== 'string') return url;
    for (var i = 0; i < HOST_MAP.length; i++) {
      if (url.indexOf(HOST_MAP[i][0]) === 0) return HOST_MAP[i][1] + url.slice(HOST_MAP[i][0].length);
    }
    for (var j = 0; j < WILDCARDS.length; j++) {
      var m = url.match(WILDCARDS[j][0]);
      if (m) return WILDCARDS[j][1] + m[1] + url.slice(m[0].length);
    }
    return url;
  }

  // Report what the document is doing back to the parent, so the spike log can
  // show failures happening inside here.
  function report(kind, detail) {
    try { parent.postMessage({ __spike: true, kind: kind, detail: String(detail).slice(0, 200) }, '*'); } catch (e) {}
  }

  document.addEventListener('securitypolicyviolation', function (e) {
    report('csp', e.violatedDirective + ' -> ' + e.blockedURI);
  });
  window.addEventListener('error', function (e) {
    if (e.target && e.target.tagName) report('loadfail', e.target.src || e.target.href);
  }, true);

  var nativeFetch = window.fetch;
  window.fetch = function (input, init) {
    if (typeof input === 'string') return nativeFetch.call(this, rw(input), init);
    if (input && typeof input.url === 'string') {
      var next = rw(input.url);
      if (next !== input.url) return nativeFetch.call(this, new Request(next, input), init);
    }
    return nativeFetch.call(this, input, init);
  };

  var open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    var args = Array.prototype.slice.call(arguments);
    args[1] = rw(String(url));
    return open.apply(this, args);
  };

  var NativeWS = window.WebSocket;
  window.WebSocket = function (url, protocols) {
    var next = String(url).replace(/^wss:\\/\\/([a-z0-9-]+)\\.twitch\\.tv/i, 'wss://' + location.host + '/.proxy/tw/$1');
    return protocols === undefined ? new NativeWS(next) : new NativeWS(next, protocols);
  };
  window.WebSocket.prototype = NativeWS.prototype;
  ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'].forEach(function (k) {
    window.WebSocket[k] = NativeWS[k];
  });

  var setAttribute = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function (name, value) {
    var lower = typeof name === 'string' ? name.toLowerCase() : '';
    if (lower === 'src' || lower === 'href') {
      return setAttribute.call(this, name, rw(String(value)));
    }
    return setAttribute.call(this, name, value);
  };

  // Patching setAttribute alone is not enough: injected scripts are normally
  // created with el.src = '...', which goes through the property setter and
  // never touches setAttribute. That is how the Kasada script slipped past.
  function patchProperty(ctor, prop) {
    if (!ctor) return;
    var desc = Object.getOwnPropertyDescriptor(ctor.prototype, prop);
    if (!desc || !desc.set) return;
    Object.defineProperty(ctor.prototype, prop, {
      configurable: true,
      enumerable: desc.enumerable,
      get: desc.get,
      set: function (value) { desc.set.call(this, rw(String(value))); }
    });
  }

  patchProperty(window.HTMLScriptElement, 'src');
  patchProperty(window.HTMLIFrameElement, 'src');
  patchProperty(window.HTMLImageElement, 'src');
  patchProperty(window.HTMLMediaElement, 'src');
  patchProperty(window.HTMLLinkElement, 'href');

  // HLS parsing often happens off the main thread.
  var NativeWorker = window.Worker;
  if (NativeWorker) {
    window.Worker = function (url, opts) {
      return opts === undefined ? new NativeWorker(rw(String(url)))
                                : new NativeWorker(rw(String(url)), opts);
    };
    window.Worker.prototype = NativeWorker.prototype;
  }

  // sendBeacon carries Twitch's telemetry; leave the data alone, fix the host.
  if (navigator.sendBeacon) {
    var beacon = navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon = function (url, data) { return beacon(rw(String(url)), data); };
  }

  report('shim', 'installed at ' + location.href);
})();`;
}
