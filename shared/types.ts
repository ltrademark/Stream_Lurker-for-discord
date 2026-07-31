/**
 * Wire types shared by the client and the server. The server is authoritative
 * for everything in RoomState; the client renders it and nothing more.
 */

export type ChannelMeta = {
  login: string;
  displayName: string;
  avatarUrl: string | null;
  live: boolean;
  title: string | null;
  game: string | null;
  viewers: number | null;
  /** ISO timestamp the current stream went live, for the uptime readout. */
  startedAt: string | null;
};

export type QueueItem = {
  /** Stable per-entry id. Not the channel login — the same channel may be queued twice. */
  id: string;
  login: string;
  addedBy: { id: string; name: string };
  addedAt: number;
  /** Null until the first Helix poll lands, or forever if Twitch creds are unset. */
  meta: ChannelMeta | null;
};

export type Participant = {
  id: string;
  name: string;
  avatarUrl: string | null;
  isModerator: boolean;
};

/** A Discord server the signed-in user belongs to. One room per guild. */
export type Guild = {
  id: string;
  name: string;
  iconUrl: string | null;
  /** Whether this user moderates this guild. Resolved server-side, never trusted from the client. */
  isModerator: boolean;
};

/** GET /api/me */
export type Me = {
  id: string;
  name: string;
  avatarUrl: string | null;
  guilds: Guild[];
};

export type RoomState = {
  guildId: string;
  current: QueueItem | null;
  queue: QueueItem[];
  participants: Participant[];
  /** False when TWITCH_CLIENT_ID is unset — the UI hides metadata affordances. */
  metadataEnabled: boolean;
};

export type ClientMessage =
  /** Join the room for a guild. Identity comes from the session cookie. */
  | { t: 'hello'; guildId: string }
  | { t: 'queue:add'; input: string }
  | { t: 'queue:remove'; id: string }
  | { t: 'queue:reorder'; id: string; index: number }
  | { t: 'play:now'; id: string }
  | { t: 'skip' }
  | { t: 'stop' }
  /** A viewer's player fired OFFLINE. Advisory — the server re-checks with Helix. */
  | { t: 'offline'; login: string };

export type ServerMessage =
  | { t: 'state'; state: RoomState; you: { id: string; isModerator: boolean } }
  | { t: 'error'; message: string };

/** Client messages only a moderator may send. Enforced server-side. */
export const MODERATOR_ONLY: ReadonlySet<ClientMessage['t']> = new Set([
  'queue:remove',
  'queue:reorder',
  'play:now',
  'skip',
  'stop',
] as const);
