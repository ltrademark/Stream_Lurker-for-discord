import { randomUUID } from 'node:crypto';
import type { WebSocket } from 'ws';
import type { ChannelMeta, Participant, QueueItem, RoomState, ServerMessage } from '../../shared/types.js';
import { metadataEnabled } from './env.js';
import { fetchChannels } from './twitch.js';

export type Client = {
  ws: WebSocket;
  userId: string;
  name: string;
  avatarUrl: string | null;
  isModerator: boolean;
};

export type Room = {
  guildId: string;
  current: QueueItem | null;
  queue: QueueItem[];
  clients: Set<Client>;
  /** Cleared on rejoin so a reload or brief disconnect doesn't wipe the queue. */
  reapTimer: NodeJS.Timeout | null;
  /** When the current channel was first seen offline, for auto-advance. */
  offlineSince: number | null;
};

const rooms = new Map<string, Room>();

/** How long an empty room survives, so reloads and reconnects keep the queue. */
const REAP_DELAY_MS = 60_000;
/** How long the current channel must read offline before we move on. */
const OFFLINE_GRACE_MS = 45_000;
const POLL_INTERVAL_MS = 30_000;

// --- lifecycle ---------------------------------------------------------------

export function joinRoom(guildId: string, client: Client): Room {
  let room = rooms.get(guildId);
  if (!room) {
    room = {
      guildId,
      current: null,
      queue: [],
      clients: new Set(),
      reapTimer: null,
      offlineSince: null,
    };
    rooms.set(guildId, room);
    console.log(`[room ${guildId}] created`);
  }

  if (room.reapTimer) {
    clearTimeout(room.reapTimer);
    room.reapTimer = null;
  }

  room.clients.add(client);
  broadcast(room);
  return room;
}

export function leaveRoom(room: Room, client: Client): void {
  room.clients.delete(client);

  if (room.clients.size === 0) {
    room.reapTimer = setTimeout(() => {
      rooms.delete(room.guildId);
      console.log(`[room ${room.guildId}] reaped`);
    }, REAP_DELAY_MS);
    return;
  }

  broadcast(room);
}

// --- broadcasting ------------------------------------------------------------

function participants(room: Room): Participant[] {
  // One entry per user even if they somehow hold two sockets mid-reconnect.
  const byUser = new Map<string, Participant>();
  for (const client of room.clients) {
    byUser.set(client.userId, {
      id: client.userId,
      name: client.name,
      avatarUrl: client.avatarUrl,
      isModerator: client.isModerator,
    });
  }
  return [...byUser.values()];
}

function snapshot(room: Room): RoomState {
  return {
    guildId: room.guildId,
    current: room.current,
    queue: room.queue,
    participants: participants(room),
    metadataEnabled,
  };
}

export function send(client: Client, message: ServerMessage): void {
  if (client.ws.readyState === client.ws.OPEN) {
    client.ws.send(JSON.stringify(message));
  }
}

export function sendError(client: Client, message: string): void {
  send(client, { t: 'error', message });
}

/**
 * Full-snapshot broadcast on every change. The state is a handful of kilobytes
 * at worst, and it makes reconnects trivial — there are no deltas to replay.
 */
export function broadcast(room: Room): void {
  const state = snapshot(room);
  for (const client of room.clients) {
    send(client, {
      t: 'state',
      state,
      you: { id: client.userId, isModerator: client.isModerator },
    });
  }
}

// --- mutations ---------------------------------------------------------------

export function addToQueue(
  room: Room,
  client: Client,
  login: string,
  meta: ChannelMeta | null,
): void {
  const item: QueueItem = {
    id: randomUUID(),
    login,
    addedBy: { id: client.userId, name: client.name },
    addedAt: Date.now(),
    meta,
  };

  // An add into an empty room plays immediately; otherwise it waits its turn.
  if (!room.current) {
    room.current = item;
    room.offlineSince = null;
  } else {
    room.queue.push(item);
  }

  broadcast(room);
}

export function removeFromQueue(room: Room, id: string): boolean {
  const index = room.queue.findIndex((item) => item.id === id);
  if (index === -1) return false;
  room.queue.splice(index, 1);
  broadcast(room);
  return true;
}

export function reorderQueue(room: Room, id: string, index: number): boolean {
  const from = room.queue.findIndex((item) => item.id === id);
  if (from === -1) return false;

  const [item] = room.queue.splice(from, 1);
  if (!item) return false;

  const to = Math.max(0, Math.min(index, room.queue.length));
  room.queue.splice(to, 0, item);
  broadcast(room);
  return true;
}

export function playNow(room: Room, id: string): boolean {
  const index = room.queue.findIndex((item) => item.id === id);
  if (index === -1) return false;

  const [item] = room.queue.splice(index, 1);
  if (!item) return false;

  // What was playing goes to the front of the queue rather than being lost.
  if (room.current) room.queue.unshift(room.current);

  room.current = item;
  room.offlineSince = null;
  broadcast(room);
  return true;
}

/** Advances to the next queued channel, dropping what was playing. */
export function skip(room: Room): void {
  room.current = room.queue.shift() ?? null;
  room.offlineSince = null;
  broadcast(room);
}

/** Clears the screen, returning what was playing to the front of the queue. */
export function stop(room: Room): void {
  if (room.current) room.queue.unshift(room.current);
  room.current = null;
  room.offlineSince = null;
  broadcast(room);
}

/**
 * A viewer's player reported OFFLINE. Advisory only — one viewer's flaky
 * connection must not skip the stream for everyone, so this is confirmed
 * against Helix before acting.
 */
export async function reportOffline(room: Room, login: string): Promise<void> {
  if (room.current?.login !== login) return;
  if (room.queue.length === 0) return;

  if (metadataEnabled) {
    try {
      const found = await fetchChannels([login]);
      const meta = found.get(login);
      if (meta?.live) {
        // Twitch says it is live; the report was wrong. Nothing to do.
        room.current.meta = meta;
        return;
      }
    } catch (err) {
      console.error('[room] offline confirmation failed, ignoring report:', err);
      return;
    }
    console.log(`[room ${room.guildId}] ${login} confirmed offline, advancing`);
    skip(room);
    return;
  }

  // Without Helix there is nothing to confirm against, so fall back to the
  // grace period in the poller rather than trusting a single client.
  room.offlineSince ??= Date.now();
}

// --- metadata polling --------------------------------------------------------

/**
 * One interval for every room. Batches all logins across all rooms into as few
 * Helix calls as possible, folds the result into the queue items, and also
 * drives auto-advance when the current channel stays offline.
 */
export function startMetadataPolling(): NodeJS.Timeout {
  const timer = setInterval(() => {
    void pollOnce();
  }, POLL_INTERVAL_MS);
  timer.unref();
  return timer;
}

async function pollOnce(): Promise<void> {
  if (rooms.size === 0) return;

  const logins = new Set<string>();
  for (const room of rooms.values()) {
    if (room.current) logins.add(room.current.login);
    for (const item of room.queue) logins.add(item.login);
  }
  if (logins.size === 0) return;

  let meta: Map<string, ChannelMeta>;
  try {
    meta = await fetchChannels([...logins]);
  } catch (err) {
    console.error('[poll] Helix refresh failed:', err);
    return;
  }

  for (const room of rooms.values()) {
    let changed = false;

    for (const item of [room.current, ...room.queue]) {
      if (!item) continue;
      const fresh = meta.get(item.login);
      if (fresh) {
        item.meta = fresh;
        changed = true;
      }
    }

    changed = advanceIfOffline(room) || changed;
    if (changed && room.clients.size > 0) broadcast(room);
  }
}

/** True if the room advanced. */
function advanceIfOffline(room: Room): boolean {
  const current = room.current;
  if (!current) return false;

  // Unknown liveness (no creds, or lookup missed) is not evidence of offline.
  if (current.meta === null || current.meta.live) {
    room.offlineSince = null;
    return false;
  }

  room.offlineSince ??= Date.now();

  if (room.queue.length > 0 && Date.now() - room.offlineSince >= OFFLINE_GRACE_MS) {
    console.log(`[room ${room.guildId}] ${current.login} offline, auto-advancing`);
    skip(room);
    return true;
  }
  return false;
}

/** Refreshes one channel's metadata right after it is queued. */
export async function refreshOne(room: Room, login: string): Promise<void> {
  if (!metadataEnabled) return;
  try {
    const meta = (await fetchChannels([login])).get(login);
    if (!meta) return;
    for (const item of [room.current, ...room.queue]) {
      if (item?.login === login) item.meta = meta;
    }
    broadcast(room);
  } catch (err) {
    console.error('[room] metadata refresh failed:', err);
  }
}
