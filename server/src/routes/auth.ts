import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import type { Guild, Me } from '../../../shared/types.js';
import { env } from '../env.js';
import { MOD_PERMISSIONS, forget, listGuilds, rememberGuilds } from '../guilds.js';
import {
  RETURN_COOKIE,
  SESSION_COOKIE,
  SESSION_TTL_MS,
  STATE_COOKIE,
  clearCookieHeader,
  cookieHeader,
  issueSession,
  parseCookies,
  verifySession,
  type Session,
} from '../session.js';

export const authRouter = Router();

const SCOPES = ['identify', 'guilds'] as const;
const STATE_TTL_MS = 10 * 60 * 1000;

/**
 * Where to land after sign-in. Only same-origin paths are allowed: anything
 * absolute, protocol-relative, or otherwise off-site is discarded, so this
 * cannot be turned into an open redirect by handing someone a crafted link.
 */
function safeReturnPath(value: unknown): string {
  if (typeof value !== 'string' || !value.startsWith('/')) return '/';
  if (value.startsWith('//') || value.includes('\\')) return '/';
  return value;
}

type DiscordUser = {
  id: string;
  username: string;
  global_name: string | null;
  avatar: string | null;
};

type DiscordGuild = {
  id: string;
  name: string;
  icon: string | null;
  owner: boolean;
  /** Decimal bitfield string of the user's computed guild-level permissions. */
  permissions: string;
};

function redirectUri(): string {
  return `${env.publicBaseUrl}/api/auth/callback`;
}

function userAvatar(user: DiscordUser): string | null {
  if (!user.avatar) return null;
  const ext = user.avatar.startsWith('a_') ? 'gif' : 'png';
  return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.${ext}?size=64`;
}

function guildIcon(guild: DiscordGuild): string | null {
  if (!guild.icon) return null;
  const ext = guild.icon.startsWith('a_') ? 'gif' : 'png';
  return `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.${ext}?size=64`;
}

async function discord<T>(path: string, accessToken: string): Promise<T> {
  const res = await fetch(`https://discord.com/api/v10${path}`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`Discord ${path} failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as T;
}

/** GET /api/auth/login — start the OAuth redirect. */
authRouter.get('/auth/login', (req, res) => {
  // Random state echoed back by Discord and compared against a cookie, so a
  // third party cannot complete a sign-in on someone else's behalf.
  const state = randomBytes(16).toString('base64url');

  const url = new URL('https://discord.com/oauth2/authorize');
  url.searchParams.set('client_id', env.discordClientId);
  url.searchParams.set('redirect_uri', redirectUri());
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', SCOPES.join(' '));

  url.searchParams.set('state', state);

  // Remember where they were headed. A shared room link carries ?server=<id>,
  // and without this the OAuth round trip would drop it and dump them on the
  // server picker instead of in the room they were invited to.
  const returnTo = safeReturnPath(req.query.return);

  res.setHeader('set-cookie', [
    cookieHeader(STATE_COOKIE, state, STATE_TTL_MS),
    cookieHeader(RETURN_COOKIE, encodeURIComponent(returnTo), STATE_TTL_MS),
  ]);
  res.redirect(url.toString());
});

/** GET /api/auth/callback — exchange the code and establish the session. */
authRouter.get('/auth/callback', async (req, res) => {
  const { code, state } = req.query;
  const expected = parseCookies(req.headers.cookie)[STATE_COOKIE];

  if (typeof code !== 'string' || typeof state !== 'string' || !expected || state !== expected) {
    res.status(400).send('Sign-in failed: state mismatch. Start again from the home page.');
    return;
  }

  try {
    const tokenRes = await fetch('https://discord.com/api/v10/oauth2/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: env.discordClientId,
        client_secret: env.discordClientSecret,
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri(),
      }),
    });

    if (!tokenRes.ok) {
      console.error('[auth] code exchange failed:', tokenRes.status, await tokenRes.text());
      res.status(401).send('Discord rejected the sign-in. Please try again.');
      return;
    }

    const { access_token, refresh_token } = (await tokenRes.json()) as {
      access_token: string;
      refresh_token: string;
    };

    const [user, guilds] = await Promise.all([
      discord<DiscordUser>('/users/@me', access_token),
      discord<DiscordGuild[]>('/users/@me/guilds', access_token),
    ]);

    // Moderator status is decided here, once, from Discord's own computed
    // permission bitfield — never from anything the browser sends later.
    const resolved: Guild[] = guilds.map((guild) => ({
      id: guild.id,
      name: guild.name,
      iconUrl: guildIcon(guild),
      isModerator: guild.owner || (BigInt(guild.permissions) & MOD_PERMISSIONS) !== 0n,
    }));

    rememberGuilds(user.id, resolved);

    const session = issueSession({
      userId: user.id,
      name: user.global_name || user.username,
      avatarUrl: userAvatar(user),
      accessToken: access_token,
      refreshToken: refresh_token ?? '',
    });

    const cookies = parseCookies(req.headers.cookie);
    const returnTo = safeReturnPath(
      cookies[RETURN_COOKIE] ? decodeURIComponent(cookies[RETURN_COOKIE]) : '/',
    );

    res.setHeader('set-cookie', [
      cookieHeader(SESSION_COOKIE, session, SESSION_TTL_MS),
      clearCookieHeader(STATE_COOKIE),
      clearCookieHeader(RETURN_COOKIE),
    ]);
    res.redirect(returnTo);
  } catch (err) {
    console.error('[auth] callback failed:', err);
    res.status(500).send('Sign-in failed. Check the server logs.');
  }
});

function resolveGuilds(guilds: DiscordGuild[]): Guild[] {
  return guilds.map((guild) => ({
    id: guild.id,
    name: guild.name,
    iconUrl: guildIcon(guild),
    isModerator: guild.owner || (BigInt(guild.permissions) & MOD_PERMISSIONS) !== 0n,
  }));
}

/** Exchanges a refresh token for a fresh access token. */
async function renewToken(refreshToken: string): Promise<{ access: string; refresh: string }> {
  const res = await fetch('https://discord.com/api/v10/oauth2/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.discordClientId,
      client_secret: env.discordClientSecret,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  });

  if (!res.ok) throw new Error(`Refresh rejected: ${res.status}`);

  const body = (await res.json()) as { access_token: string; refresh_token: string };
  return { access: body.access_token, refresh: body.refresh_token ?? refreshToken };
}

/**
 * Rebuilds the guild cache from Discord, renewing the access token first if it
 * has expired. Returns a replacement session cookie when the token changed, so
 * the caller can persist it.
 */
async function refreshGuilds(
  session: Session,
): Promise<{ guilds: Guild[]; newCookie: string | null }> {
  try {
    const guilds = await discord<DiscordGuild[]>('/users/@me/guilds', session.accessToken);
    rememberGuilds(session.userId, resolveGuilds(guilds));
    return { guilds: resolveGuilds(guilds), newCookie: null };
  } catch (err) {
    // Most likely the access token aged out. Renew and try once more before
    // giving up and sending them back to sign-in.
    if (!session.refreshToken) throw err;

    const renewed = await renewToken(session.refreshToken);
    const guilds = await discord<DiscordGuild[]>('/users/@me/guilds', renewed.access);
    const resolved = resolveGuilds(guilds);
    rememberGuilds(session.userId, resolved);

    const refreshedSession = issueSession({
      userId: session.userId,
      name: session.name,
      avatarUrl: session.avatarUrl,
      accessToken: renewed.access,
      refreshToken: renewed.refresh,
    });
    return { guilds: resolved, newCookie: cookieHeader(SESSION_COOKIE, refreshedSession, SESSION_TTL_MS) };
  }
}

/** GET /api/me — who am I, and which servers can I open a room for? */
authRouter.get('/me', async (req, res) => {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  const session = token ? verifySession(token) : null;

  if (!session) {
    res.status(401).json({ error: 'Not signed in.' });
    return;
  }

  let guilds = listGuilds(session.userId);

  // Empty means the process restarted and lost the cache, not that the user is
  // signed out. Rebuild it from Discord rather than making them sign in again.
  if (guilds.length === 0) {
    try {
      const refreshed = await refreshGuilds(session);
      guilds = refreshed.guilds;
      if (refreshed.newCookie) {
        res.setHeader('set-cookie', refreshed.newCookie);
        console.log(`[auth] renewed Discord token for ${session.name}`);
      }
      console.log(`[auth] rebuilt guild cache for ${session.name}`);
    } catch (err) {
      console.error('[auth] guild refresh failed, session is unusable:', err);
      res.setHeader('set-cookie', clearCookieHeader(SESSION_COOKIE));
      res.status(401).json({ error: 'Session expired. Sign in again.' });
      return;
    }
  }

  const me: Me = {
    id: session.userId,
    name: session.name,
    avatarUrl: session.avatarUrl,
    guilds,
  };
  res.json(me);
});

authRouter.post('/logout', (req, res) => {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  const session = token ? verifySession(token) : null;
  if (session) forget(session.userId);

  res.setHeader('set-cookie', clearCookieHeader(SESSION_COOKIE));
  res.json({ ok: true });
});
