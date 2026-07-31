import type { IncomingMessage, Server } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { MODERATOR_ONLY, type ClientMessage } from '../../shared/types.js';
import { parseChannelInput } from '../../shared/twitch.js';
import { guildFor } from './guilds.js';
import { SESSION_COOKIE, parseCookies, verifySession, type Session } from './session.js';
import { lookupChannel } from './twitch.js';
import {
  addToQueue,
  joinRoom,
  leaveRoom,
  playNow,
  refreshOne,
  removeFromQueue,
  reorderQueue,
  reportOffline,
  sendError,
  skip,
  stop,
  type Client,
  type Room,
} from './rooms.js';

/** A socket that never says hello is not a client. */
const HELLO_TIMEOUT_MS = 10_000;
/** Per-socket add budget, refilled continuously. */
const ADD_LIMIT = 10;
const ADD_WINDOW_MS = 60_000;

export function attachWebSocketServer(server: Server): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    if (new URL(req.url ?? '/', 'http://localhost').pathname !== '/ws') {
      socket.destroy();
      return;
    }

    // Identity is established here, from the same signed cookie the HTTP routes
    // use. The browser sends it automatically on a same-origin WebSocket, so no
    // token is ever handled by client code.
    const session = sessionFrom(req);
    if (!session) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req, session));
  });

  wss.on('connection', (ws: WebSocket, _req: IncomingMessage, session: Session) => {
    let client: Client | null = null;
    let room: Room | null = null;
    const addTimes: number[] = [];

    const helloTimer = setTimeout(() => {
      if (!client) ws.close(4001, 'no hello');
    }, HELLO_TIMEOUT_MS);

    ws.on('message', (raw) => {
      let message: ClientMessage;
      try {
        message = JSON.parse(String(raw)) as ClientMessage;
      } catch {
        return;
      }
      if (!message || typeof message.t !== 'string') return;

      // --- joining a room --------------------------------------------------
      if (message.t === 'hello') {
        if (client) return;

        // The gate: the guild must be one this user actually belongs to, and
        // their moderator status comes from what Discord told us at sign-in.
        // A client naming someone else's server gets nothing.
        // Also fires when the server has restarted: the signed cookie is still
        // valid, but the in-memory guild store it was resolved into is gone.
        // Either way the client must sign in again, so say so unambiguously.
        const guild = guildFor(session.userId, String(message.guildId));
        if (!guild) {
          ws.close(4004, 'session expired or not a member of that server');
          return;
        }

        clearTimeout(helloTimer);
        client = {
          ws,
          userId: session.userId,
          name: session.name,
          avatarUrl: session.avatarUrl,
          isModerator: guild.isModerator,
        };
        room = joinRoom(guild.id, client);
        console.log(
          `[ws] ${session.name} joined ${guild.name}` + (guild.isModerator ? ' (moderator)' : ''),
        );
        return;
      }

      if (!client || !room) {
        ws.close(4002, 'hello required first');
        return;
      }

      // --- authorisation ---------------------------------------------------
      // The single gate for every mutating command. The client's own idea of
      // its moderator status is irrelevant; only the server's is consulted.
      if (MODERATOR_ONLY.has(message.t) && !client.isModerator) {
        sendError(client, 'Only server moderators can do that.');
        return;
      }

      void handle(message, client, room, addTimes);
    });

    ws.on('close', () => {
      clearTimeout(helloTimer);
      if (client && room) {
        console.log(`[ws] ${client.name} left ${room.guildId}`);
        leaveRoom(room, client);
      }
    });

    ws.on('error', (err) => console.error('[ws] socket error:', err.message));
  });

  return wss;
}

function sessionFrom(req: IncomingMessage): Session | null {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  return token ? verifySession(token) : null;
}

async function handle(
  message: ClientMessage,
  client: Client,
  room: Room,
  addTimes: number[],
): Promise<void> {
  switch (message.t) {
    case 'queue:add': {
      const now = Date.now();
      while (addTimes.length > 0 && now - addTimes[0]! > ADD_WINDOW_MS) addTimes.shift();
      if (addTimes.length >= ADD_LIMIT) {
        sendError(client, 'Slow down a moment — too many additions.');
        return;
      }
      addTimes.push(now);

      const parsed = parseChannelInput(String(message.input ?? ''));
      if (!parsed.ok) {
        sendError(client, parsed.error);
        return;
      }
      const { login } = parsed;

      if (room.current?.login === login || room.queue.some((i) => i.login === login)) {
        sendError(client, `${login} is already playing or queued.`);
        return;
      }

      // undefined means "could not verify" — accept rather than block on it.
      const meta = await lookupChannel(login);
      if (meta === null) {
        sendError(client, `No Twitch channel called “${login}”.`);
        return;
      }

      addToQueue(room, client, login, meta ?? null);
      if (meta === undefined) void refreshOne(room, login);
      return;
    }

    case 'queue:remove':
      if (!removeFromQueue(room, String(message.id))) {
        sendError(client, 'That entry is no longer in the queue.');
      }
      return;

    case 'queue:reorder':
      if (!reorderQueue(room, String(message.id), Number(message.index))) {
        sendError(client, 'That entry is no longer in the queue.');
      }
      return;

    case 'play:now':
      if (!playNow(room, String(message.id))) {
        sendError(client, 'That entry is no longer in the queue.');
      }
      return;

    case 'skip':
      skip(room);
      return;

    case 'stop':
      stop(room);
      return;

    case 'offline':
      await reportOffline(room, String(message.login));
      return;
  }
}
