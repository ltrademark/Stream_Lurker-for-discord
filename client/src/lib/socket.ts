import type { ClientMessage, ServerMessage } from '../../../shared/types.ts';

type Handlers = {
  onMessage: (message: ServerMessage) => void;
  onStatusChange: (connected: boolean) => void;
  /**
   * The server refused us outright. Retrying cannot help — the caller should
   * send the user back to sign-in.
   */
  onRejected: (reason: string) => void;
};

/**
 * Close codes that mean "do not retry". 4003/4004 are issued when the session
 * is unusable — most commonly because the server restarted and lost the
 * in-memory record of which servers this user belongs to.
 */
const FATAL_CLOSE_CODES = new Map<number, string>([
  [4003, 'Your session is no longer valid. Please sign in again.'],
  [4004, 'Your session expired. Please sign in again.'],
]);

const RECONNECT_MIN_MS = 500;
const RECONNECT_MAX_MS = 8_000;

/**
 * Auto-reconnecting socket. Because the server broadcasts full snapshots there
 * is nothing to replay after a drop — say hello again and the next state
 * message brings us current.
 *
 * Identity travels in the session cookie the browser attaches automatically, so
 * no credential is ever handled here.
 */
export class RoomSocket {
  private ws: WebSocket | null = null;
  private retryDelay = RECONNECT_MIN_MS;
  private retryTimer: number | null = null;
  private closed = false;

  constructor(
    private readonly guildId: string,
    private readonly handlers: Handlers,
  ) {
    this.connect();
  }

  private connect(): void {
    if (this.closed) return;

    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${location.host}/ws`);
    this.ws = ws;

    ws.addEventListener('open', () => {
      this.retryDelay = RECONNECT_MIN_MS;
      this.send({ t: 'hello', guildId: this.guildId });
      this.handlers.onStatusChange(true);
    });

    ws.addEventListener('message', (event) => {
      try {
        this.handlers.onMessage(JSON.parse(String(event.data)) as ServerMessage);
      } catch {
        // A malformed frame is not worth tearing the connection down over.
      }
    });

    ws.addEventListener('close', (event) => {
      this.handlers.onStatusChange(false);

      const fatal = FATAL_CLOSE_CODES.get(event.code);
      if (fatal) {
        this.closed = true;
        this.handlers.onRejected(fatal);
        return;
      }
      this.scheduleReconnect();
    });

    ws.addEventListener('error', () => ws.close());
  }

  private scheduleReconnect(): void {
    if (this.closed || this.retryTimer !== null) return;

    this.retryTimer = window.setTimeout(() => {
      this.retryTimer = null;
      this.connect();
    }, this.retryDelay);

    this.retryDelay = Math.min(this.retryDelay * 2, RECONNECT_MAX_MS);
  }

  send(message: ClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  close(): void {
    this.closed = true;
    if (this.retryTimer !== null) clearTimeout(this.retryTimer);
    this.ws?.close();
  }
}
