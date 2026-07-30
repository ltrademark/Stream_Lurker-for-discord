import { useCallback, useEffect, useRef, useState } from 'react';
import type { ClientMessage, RoomState } from '../../shared/types.ts';
import { AddChannel } from './components/AddChannel.tsx';
import { Controls } from './components/Controls.tsx';
import { NowPlaying } from './components/NowPlaying.tsx';
import { Participants } from './components/Participants.tsx';
import { Player } from './components/Player.tsx';
import { Queue } from './components/Queue.tsx';
import { applyUrlMappings, authenticate, isInsideDiscord } from './lib/discord.ts';
import { loadPrefs, savePrefs, type Prefs } from './lib/prefs.ts';
import { RoomSocket } from './lib/socket.ts';

type Phase =
  | { name: 'booting' }
  | { name: 'outside' }
  | { name: 'failed'; error: string }
  | { name: 'live' };

const EMPTY_STATE: RoomState = {
  current: null,
  queue: [],
  participants: [],
  metadataEnabled: false,
};

export function App() {
  const [phase, setPhase] = useState<Phase>({ name: 'booting' });
  const [state, setState] = useState<RoomState>(EMPTY_STATE);
  const [isModerator, setIsModerator] = useState(false);
  const [connected, setConnected] = useState(false);
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs);
  const [qualities, setQualities] = useState<string[]>([]);
  const [toast, setToast] = useState<string | null>(null);

  const socketRef = useRef<RoomSocket | null>(null);

  // --- boot ---------------------------------------------------------------
  useEffect(() => {
    if (!isInsideDiscord()) {
      setPhase({ name: 'outside' });
      return;
    }

    let socket: RoomSocket | null = null;
    // StrictMode mounts effects twice in dev; without this the first run's
    // socket is created after its own cleanup has already gone by, and leaks.
    let cancelled = false;

    // Must run before anything tries to reach Twitch.
    applyUrlMappings();

    authenticate()
      .then(({ session }) => {
        if (cancelled) return;

        socket = new RoomSocket(session, {
          onStatusChange: setConnected,
          onMessage: (message) => {
            if (message.t === 'state') {
              setState(message.state);
              setIsModerator(message.you.isModerator);
            } else if (message.t === 'error') {
              setToast(message.message);
            }
          },
        });
        socketRef.current = socket;
        setPhase({ name: 'live' });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        console.error('[boot]', err);
        setPhase({
          name: 'failed',
          error: err instanceof Error ? err.message : String(err),
        });
      });

    return () => {
      cancelled = true;
      socket?.close();
      socketRef.current = null;
    };
  }, []);

  // --- toasts self-dismiss ------------------------------------------------
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  const send = useCallback((message: ClientMessage) => {
    socketRef.current?.send(message);
  }, []);

  const updatePrefs = useCallback((patch: Partial<Prefs>) => {
    setPrefs((previous) => {
      const next = { ...previous, ...patch };
      savePrefs(next);
      return next;
    });
  }, []);

  // --- boot screens -------------------------------------------------------
  if (phase.name === 'booting') {
    return (
      <div className="boot">
        <div className="spinner" />
        <p>Connecting to Discord…</p>
      </div>
    );
  }

  if (phase.name === 'outside') {
    return (
      <div className="boot">
        <h1>Launch this from Discord</h1>
        <p>
          This is a Discord Activity. Join a voice channel, press the rocket button in the
          call controls, and pick it from the shelf.
        </p>
      </div>
    );
  }

  if (phase.name === 'failed') {
    return (
      <div className="boot">
        <h1>Couldn’t start</h1>
        <p style={{ whiteSpace: 'pre-wrap' }}>{phase.error}</p>
        <p>
          Check <code>.env</code> and the URL mappings in the Developer Portal, then reload.
        </p>
      </div>
    );
  }

  const current = state.current;

  return (
    <div className="app">
      <div className="stage">
        <Player
          login={current?.login ?? null}
          prefs={prefs}
          onUnmute={() => updatePrefs({ muted: false })}
          onQualities={setQualities}
          onOffline={(login) => send({ t: 'offline', login })}
        />
        <Controls
          prefs={prefs}
          qualities={qualities}
          isModerator={isModerator}
          hasCurrent={Boolean(current)}
          hasQueue={state.queue.length > 0}
          onPrefsChange={updatePrefs}
          onSkip={() => send({ t: 'skip' })}
          onStop={() => send({ t: 'stop' })}
        />
      </div>

      <div className="sidebar">
        <NowPlaying item={current} metadataEnabled={state.metadataEnabled} />

        <div className="section-head">
          Up next
          {state.queue.length > 0 && <span className="count">{state.queue.length}</span>}
        </div>

        <Queue
          items={state.queue}
          isModerator={isModerator}
          onPlayNow={(id) => send({ t: 'play:now', id })}
          onRemove={(id) => send({ t: 'queue:remove', id })}
          onReorder={(id, index) => send({ t: 'queue:reorder', id, index })}
        />

        <AddChannel onAdd={(input) => send({ t: 'queue:add', input })} />
        <Participants participants={state.participants} connected={connected} />
      </div>

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
