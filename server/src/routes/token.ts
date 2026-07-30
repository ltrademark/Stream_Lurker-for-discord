import { Router } from 'express';
import { env } from '../env.js';
import { issueSession } from '../session.js';

export const tokenRouter = Router();

/** Discord permission bits that count as "moderator" for this activity. */
const MOD_PERMISSIONS =
  (1n << 3n) | // ADMINISTRATOR
  (1n << 5n) | // MANAGE_GUILD
  (1n << 4n) | // MANAGE_CHANNELS
  (1n << 24n); // MOVE_MEMBERS

type DiscordUser = {
  id: string;
  username: string;
  global_name: string | null;
  avatar: string | null;
};

type DiscordGuild = {
  id: string;
  owner: boolean;
  /** Decimal bitfield string of the user's computed guild-level permissions. */
  permissions: string;
};

function avatarUrl(user: DiscordUser): string | null {
  if (!user.avatar) return null;
  const ext = user.avatar.startsWith('a_') ? 'gif' : 'png';
  // Served through the activity's proxy; see the /discord-cdn URL mapping.
  return `/.proxy/discord-cdn/avatars/${user.id}/${user.avatar}.${ext}?size=64`;
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

/**
 * POST /api/token
 *
 * Exchanges the SDK's OAuth code for an access token, resolves the caller's
 * identity and moderator status server-side, and returns a signed session the
 * WebSocket authenticates with. The client is never trusted for isModerator.
 *
 * Caveat worth knowing: instanceId and guildId come from the Embedded App SDK
 * on the client, and Discord exposes no server-side way to verify that a given
 * OAuth code actually belongs to a given activity instance. So a determined
 * user who is an admin of *some* guild could claim moderator in a room they
 * name. That is inherent to Activities, and the blast radius is one voice
 * channel of people who already trust each other enough to be in it.
 */
tokenRouter.post('/token', async (req, res) => {
  const { code, instanceId, guildId } = req.body ?? {};

  if (typeof code !== 'string' || typeof instanceId !== 'string' || !instanceId) {
    res.status(400).json({ error: 'code and instanceId are required' });
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
      }),
    });

    if (!tokenRes.ok) {
      console.error('[auth] code exchange failed:', tokenRes.status, await tokenRes.text());
      res.status(401).json({ error: 'Discord rejected the authorization code.' });
      return;
    }

    const { access_token } = (await tokenRes.json()) as { access_token: string };
    const user = await discord<DiscordUser>('/users/@me', access_token);

    let isModerator = false;
    if (typeof guildId === 'string' && guildId) {
      try {
        const guilds = await discord<DiscordGuild[]>('/users/@me/guilds', access_token);
        const guild = guilds.find((g) => g.id === guildId);
        if (guild) {
          isModerator = guild.owner || (BigInt(guild.permissions) & MOD_PERMISSIONS) !== 0n;
        }
      } catch (err) {
        // Fail closed: no permission proof means no moderator rights.
        console.error('[auth] guild permission lookup failed:', err);
      }
    } else {
      // No guild means a DM or group DM. There are no roles to check, so
      // everyone present gets the controls.
      isModerator = true;
    }

    const session = issueSession({
      userId: user.id,
      name: user.global_name || user.username,
      avatarUrl: avatarUrl(user),
      instanceId,
      isModerator,
    });

    res.json({ access_token, session });
  } catch (err) {
    console.error('[auth] token route failed:', err);
    res.status(500).json({ error: 'Authentication failed. Check the server logs.' });
  }
});
