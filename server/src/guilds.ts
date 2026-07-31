import type { Guild } from '../../shared/types.js';
import { SESSION_TTL_MS } from './session.js';

/**
 * Per-user guild membership and moderator status, resolved once at sign-in.
 *
 * Kept server-side rather than in the session cookie for two reasons: a user in
 * a hundred servers would blow the cookie size limit, and a client must never be
 * able to edit its own moderator flag. Cleared when the session would expire.
 */
type Entry = { guilds: Map<string, Guild>; exp: number };

const byUser = new Map<string, Entry>();

/** Discord permission bits that count as "moderator" for this app. */
export const MOD_PERMISSIONS =
  (1n << 3n) | // ADMINISTRATOR
  (1n << 5n) | // MANAGE_GUILD
  (1n << 4n) | // MANAGE_CHANNELS
  (1n << 24n); // MOVE_MEMBERS

export function rememberGuilds(userId: string, guilds: Guild[]): void {
  byUser.set(userId, {
    guilds: new Map(guilds.map((g) => [g.id, g])),
    exp: Date.now() + SESSION_TTL_MS,
  });
}

export function listGuilds(userId: string): Guild[] {
  return [...(read(userId)?.guilds.values() ?? [])].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The authoritative answer to "may this user moderate this room?". Returns null
 * when the user is not in the guild at all, which is also how a request for
 * someone else's room gets refused.
 */
export function guildFor(userId: string, guildId: string): Guild | null {
  return read(userId)?.guilds.get(guildId) ?? null;
}

export function forget(userId: string): void {
  byUser.delete(userId);
}

function read(userId: string): Entry | null {
  const entry = byUser.get(userId);
  if (!entry) return null;

  if (entry.exp < Date.now()) {
    byUser.delete(userId);
    return null;
  }
  return entry;
}
