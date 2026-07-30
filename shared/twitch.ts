/**
 * Channel input parsing, shared so the client can give instant feedback while
 * the server stays authoritative. Live channels only — VODs and clips are
 * rejected with a specific message rather than a generic "invalid".
 */

export type ParseResult =
  | { ok: true; login: string }
  | { ok: false; error: string };

/**
 * Twitch logins are alphanumeric + underscore. New accounts are 4-25 chars but
 * legacy channels can be shorter, so this stays permissive and lets the Helix
 * lookup be the real existence check.
 */
const LOGIN_RE = /^[a-zA-Z0-9_]{2,25}$/;

const MSG = {
  vod: 'That’s a VOD link. This activity plays live channels only.',
  clip: 'That’s a clip link. This activity plays live channels only.',
  collection: 'That’s a collection link. This activity plays live channels only.',
  browse: 'That’s a browse page, not a channel.',
  account: 'That’s a Twitch account page, not a channel.',
  product: 'That’s a Twitch product page, not a channel.',
  team: 'That’s a team page. Add the individual channel instead.',
  modView: 'That’s a mod-view link. Use the plain channel name instead.',
  popout: 'That’s a popout link. Use the plain channel name instead.',
} as const;

/** First-path-segment values on twitch.tv that are pages, not channels. */
const NOT_A_CHANNEL = new Map<string, string>([
  ['videos', MSG.vod],
  ['clips', MSG.clip],
  ['collections', MSG.collection],
  ['directory', MSG.browse],
  ['settings', MSG.account],
  ['subscriptions', MSG.account],
  ['drops', MSG.account],
  ['wallet', MSG.account],
  ['inventory', MSG.account],
  ['downloads', MSG.product],
  ['turbo', MSG.product],
  ['jobs', MSG.product],
  ['prime', MSG.product],
  ['team', MSG.team],
  ['moderator', MSG.modView],
  ['popout', MSG.popout],
  ['u', MSG.account],
  ['p', MSG.product],
]);

export function parseChannelInput(raw: string): ParseResult {
  const trimmed = raw.trim().replace(/^@/, '');
  if (!trimmed) return { ok: false, error: 'Enter a Twitch channel name or URL.' };

  // Anything URL-ish goes through the URL parser; a bare word does not.
  if (trimmed.includes('/') || trimmed.includes('.')) {
    return parseUrl(trimmed);
  }

  return validateLogin(trimmed);
}

function parseUrl(input: string): ParseResult {
  let url: URL;
  try {
    url = new URL(/^[a-z]+:\/\//i.test(input) ? input : `https://${input}`);
  } catch {
    return { ok: false, error: 'That doesn’t look like a Twitch channel or URL.' };
  }

  const host = url.hostname.toLowerCase().replace(/^www\./, '');

  if (host === 'clips.twitch.tv') {
    return { ok: false, error: MSG.clip };
  }
  if (host !== 'twitch.tv' && host !== 'm.twitch.tv' && !host.endsWith('.twitch.tv')) {
    return { ok: false, error: 'Only twitch.tv links work here.' };
  }

  const segments = url.pathname.split('/').filter(Boolean);
  const first = segments[0];
  if (!first) {
    return { ok: false, error: 'That’s the Twitch homepage. Add a channel name.' };
  }

  // /<channel>/clip/<slug> and /<channel>/video/<id> are not the live stream.
  const second = segments[1]?.toLowerCase();
  if (second === 'clip') return { ok: false, error: MSG.clip };
  if (second === 'video' || second === 'v') return { ok: false, error: MSG.vod };

  return validateLogin(first);
}

function validateLogin(candidate: string): ParseResult {
  const login = candidate.toLowerCase();

  const reserved = NOT_A_CHANNEL.get(login);
  if (reserved) return { ok: false, error: reserved };

  if (!LOGIN_RE.test(login)) {
    return {
      ok: false,
      error: 'Channel names use only letters, numbers and underscores.',
    };
  }

  return { ok: true, login };
}
