import { env, metadataEnabled } from './env.js';
import type { ChannelMeta } from '../../shared/types.js';

/** Helix accepts up to 100 logins per request. */
const BATCH_SIZE = 100;

let appToken: { value: string; expiresAt: number } | null = null;

async function getAppToken(): Promise<string> {
  if (appToken && appToken.expiresAt > Date.now() + 60_000) return appToken.value;

  const res = await fetch('https://id.twitch.tv/oauth2/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.twitchClientId,
      client_secret: env.twitchClientSecret,
      grant_type: 'client_credentials',
    }),
  });

  if (!res.ok) {
    throw new Error(`Twitch token request failed: ${res.status} ${await res.text()}`);
  }

  const body = (await res.json()) as { access_token: string; expires_in: number };
  appToken = {
    value: body.access_token,
    expiresAt: Date.now() + body.expires_in * 1000,
  };
  return appToken.value;
}

/** GETs a Helix endpoint, retrying once with a fresh token on 401. */
async function helix<T>(path: string, params: URLSearchParams): Promise<T> {
  const attempt = async (token: string) =>
    fetch(`https://api.twitch.tv/helix/${path}?${params}`, {
      headers: { 'client-id': env.twitchClientId, authorization: `Bearer ${token}` },
    });

  let res = await attempt(await getAppToken());
  if (res.status === 401) {
    appToken = null;
    res = await attempt(await getAppToken());
  }

  if (!res.ok) {
    throw new Error(`Helix ${path} failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as T;
}

type HelixUser = {
  login: string;
  display_name: string;
  profile_image_url: string;
};

/**
 * Rewrites Twitch's absolute CDN URLs into activity proxy paths. Doing it here
 * means the wire type already carries something the sandbox can load, and the
 * client never has to think about it. Requires the URL mapping
 * /twitch-cdn -> static-cdn.jtvnw.net.
 */
function proxyAvatar(url: string | undefined): string | null {
  if (!url) return null;
  const prefix = 'https://static-cdn.jtvnw.net/';
  return url.startsWith(prefix) ? `/.proxy/twitch-cdn/${url.slice(prefix.length)}` : url;
}

type HelixStream = {
  user_login: string;
  title: string;
  game_name: string;
  viewer_count: number;
  started_at: string;
};

/**
 * Looks up display name, avatar and live status for up to a few hundred logins.
 * Logins absent from the result do not exist on Twitch.
 *
 * Returns an empty map when Twitch credentials are unset — every caller treats
 * missing metadata as "unknown", never as "invalid".
 */
export async function fetchChannels(logins: string[]): Promise<Map<string, ChannelMeta>> {
  const out = new Map<string, ChannelMeta>();
  if (!metadataEnabled || logins.length === 0) return out;

  const unique = [...new Set(logins.map((l) => l.toLowerCase()))];

  for (let i = 0; i < unique.length; i += BATCH_SIZE) {
    const batch = unique.slice(i, i + BATCH_SIZE);

    const params = (key: string): URLSearchParams =>
      new URLSearchParams(batch.map((login): [string, string] => [key, login]));

    const [users, streams] = await Promise.all([
      helix<{ data: HelixUser[] }>('users', params('login')),
      helix<{ data: HelixStream[] }>('streams', params('user_login')),
    ]);

    const live = new Map(streams.data.map((s) => [s.user_login.toLowerCase(), s]));

    for (const user of users.data) {
      const login = user.login.toLowerCase();
      const stream = live.get(login);
      out.set(login, {
        login,
        displayName: user.display_name || login,
        avatarUrl: proxyAvatar(user.profile_image_url),
        live: Boolean(stream),
        title: stream?.title ?? null,
        game: stream?.game_name || null,
        viewers: stream?.viewer_count ?? null,
        startedAt: stream?.started_at ?? null,
      });
    }
  }

  return out;
}

/**
 * Existence check for queue:add. Resolves to null when the channel does not
 * exist, and to undefined when we simply cannot tell (no creds, Twitch down) —
 * callers accept the channel in the undefined case rather than blocking on it.
 */
export async function lookupChannel(login: string): Promise<ChannelMeta | null | undefined> {
  if (!metadataEnabled) return undefined;
  try {
    const found = await fetchChannels([login]);
    return found.get(login.toLowerCase()) ?? null;
  } catch (err) {
    console.error('[twitch] lookup failed, accepting channel unverified:', err);
    return undefined;
  }
}
