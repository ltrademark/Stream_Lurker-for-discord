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
 * Matches the variable part of a *.ttvnw.net host, however many labels it has.
 * Kept separate from WILDCARD_SPECS because these need label-splitting, not a
 * flat prefix — see ttvnwPath.
 */
export const TTVNW_SOURCE = '^https://([a-z0-9-]+(?:\\.[a-z0-9-]+)*)\\.ttvnw\\.net';

/**
 * Builds the proxy path for a *.ttvnw.net host.
 *
 * Discord's {parameter} matches a single label and will not span dots, proven
 * with a control: /ttvnw/usher maps, /ttvnw/video-weaver.iad02.hls does not.
 * Video segments live on 3- and 4-label hosts, so each label gets its own
 * parameter and the mapping is chosen by label count:
 *
 *   usher.ttvnw.net                    -> /.proxy/ttvnw/usher
 *   video-weaver.iad02.hls.ttvnw.net   -> /.proxy/ttvnw3/video-weaver/iad02/hls
 *   video-edge-x.iad02.abs.hls.ttvnw…  -> /.proxy/ttvnw4/video-edge-x/iad02/abs/hls
 *
 * Defined as a plain function with no outer references so shimSource() can
 * serialise it and both sides stay in step.
 */
export function ttvnwPath(labelsStr) {
  var labels = labelsStr.split('.');
  var suffix = labels.length === 1 ? '' : String(labels.length);
  return '/.proxy/ttvnw' + suffix + '/' + labels.join('/');
}

/**
 * Flat wildcard rules as [regexSource, proxyPrefix] pairs, for hosts whose
 * variable part is always a single label.
 *
 * Held as strings on purpose: the shim needs the same rules and runs inside the
 * player document as generated source. One table both sides compile means a
 * host added here cannot go missing there — which is exactly how the Kasada
 * script stayed blocked after being "fixed" once already.
 */
export const WILDCARD_SPECS = [
  ['^https://([a-z0-9-]+)\\.jtvnw\\.net', '/.proxy/jtv/'],
  // k.twitchcdn.net serves Kasada bot detection. Twitch gates playback on it,
  // so blocking it is not cosmetic.
  ['^https://([a-z0-9-]+)\\.twitchcdn\\.net', '/.proxy/twitchcdn/'],
  // www/m/passport are human-facing pages, not assets. Proxying them would
  // send "watch on Twitch" clicks into the sandbox instead of a real browser.
  ['^https://(?!www\\.|m\\.|passport\\.)([a-z0-9-]+)\\.twitch\\.tv', '/.proxy/tw/'],
];

export const WILDCARDS = WILDCARD_SPECS.map(([source, prefix]) => [
  new RegExp(source, 'i'),
  prefix,
]);

const TTVNW_RE = new RegExp(TTVNW_SOURCE, 'i');

/** Rewrites a single absolute URL. Returns it unchanged if nothing matches. */
export function rewriteUrl(url) {
  if (typeof url !== 'string') return url;

  for (const [from, to] of HOST_MAP) {
    if (url.startsWith(from)) return to + url.slice(from.length);
  }

  const ttvnw = url.match(TTVNW_RE);
  if (ttvnw) return ttvnwPath(ttvnw[1]) + url.slice(ttvnw[0].length);

  for (const [re, prefix] of WILDCARDS) {
    const match = url.match(re);
    if (match) return prefix + match[1] + url.slice(match[0].length);
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
    .replace(/https:\/\/([a-z0-9-]+(?:\.[a-z0-9-]+)*)\.ttvnw\.net/gi, (_m, labels) => ttvnwPath(labels))
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
    .replace(/https:\/\/([a-z0-9-]+(?:\.[a-z0-9-]+)*)\.ttvnw\.net/gi, (_m, labels) => ttvnwPath(labels))
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
  var TTVNW_RE = new RegExp(${JSON.stringify(TTVNW_SOURCE)}, 'i');
  ${ttvnwPath.toString()}
  // Compiled from the same WILDCARD_SPECS the server uses, so the two tables
  // cannot drift apart.
  var WILDCARDS = ${JSON.stringify(WILDCARD_SPECS)}.map(function (spec) {
    return [new RegExp(spec[0], 'i'), spec[1]];
  });

  function rw(url) {
    if (typeof url !== 'string' || url === '') return url;

    // Protocol-relative: normalise then fall through to the host rules.
    if (url.slice(0, 2) === '//') url = 'https:' + url;

    for (var i = 0; i < HOST_MAP.length; i++) {
      if (url.indexOf(HOST_MAP[i][0]) === 0) return HOST_MAP[i][1] + url.slice(HOST_MAP[i][0].length);
    }
    var tt = url.match(TTVNW_RE);
    if (tt) return ttvnwPath(tt[1]) + url.slice(tt[0].length);

    for (var j = 0; j < WILDCARDS.length; j++) {
      var m = url.match(WILDCARDS[j][0]);
      if (m) return WILDCARDS[j][1] + m[1] + url.slice(m[0].length);
    }

    // Absolute URLs on our own origin. Kasada composes location.origin + a root
    // path, so its request arrives already absolute and would otherwise pass
    // through untouched, landing at the activity root instead of the player
    // prefix. Same reasoning as the root-relative case below.
    var selfPrefix = location.origin + '/';
    if (url.indexOf(selfPrefix) === 0) {
      var samePath = url.slice(location.origin.length);
      if (samePath.indexOf('/.proxy/') !== 0) {
        return location.origin + '/.proxy/twitch-player' + samePath;
      }
      return url;
    }

    // Root-relative paths. A <base href> cannot help here: anything starting
    // with "/" resolves against the origin and ignores base entirely. This
    // document was authored to live at player.twitch.tv, so every root-relative
    // path in it belongs to that origin. Paths we already proxied are left alone.
    if (url.charAt(0) === '/' && url.indexOf('/.proxy/') !== 0) {
      return '/.proxy/twitch-player' + url;
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

  // A 4xx/5xx does not fire an error event, so without this a failing request
  // is completely silent — which is how the last round looked "clean" while
  // still not playing.
  function watch(url, status) {
    if (status >= 400) report('http', status + ' ' + url);
  }

  var nativeFetch = window.fetch;
  window.fetch = function (input, init) {
    var target = typeof input === 'string' ? rw(input)
               : (input && typeof input.url === 'string' ? rw(input.url) : null);

    var promise;
    if (typeof input === 'string') promise = nativeFetch.call(this, target, init);
    else if (target && target !== input.url) promise = nativeFetch.call(this, new Request(target, input), init);
    else promise = nativeFetch.call(this, input, init);

    return promise.then(function (res) {
      watch(target || (input && input.url) || '?', res.status);
      return res;
    }, function (err) {
      report('neterr', (target || '?') + ' — ' + err.message);
      throw err;
    });
  };

  var open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    var args = Array.prototype.slice.call(arguments);
    var target = rw(String(url));
    args[1] = target;
    this.addEventListener('load', function () { watch(target, this.status); });
    this.addEventListener('error', function () { report('neterr', target + ' — XHR error'); });
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

  // Does an inline <script> run at all in here? Discord's CSP carries a nonce
  // and no 'unsafe-inline', so Twitch's un-nonced inline bootstrap scripts may
  // be silently dropped — which would leave the app shell rendering while the
  // config telling it which channel to play never arrives. The server injects a
  // marker inline script right after this one; if the flag is missing, inline
  // execution is blocked and that is the whole problem.
  function checkInline() {
    report('inline', window.__spikeInlineRan === true ? 'INLINE SCRIPTS RUN' : 'INLINE SCRIPTS BLOCKED');
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', checkInline);
  } else {
    checkInline();
  }

  report('shim', 'installed at ' + location.href);
})();`;
}
