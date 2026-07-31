import { useCallback, useEffect, useRef, useState } from 'react';
import type { ClientMessage, Me, RoomState } from '../../shared/types.ts';
import { AddChannel } from './components/AddChannel.tsx';
import { Controls } from './components/Controls.tsx';
import { GuildPicker } from './components/GuildPicker.tsx';
import { NowPlaying } from './components/NowPlaying.tsx';
import { Participants } from './components/Participants.tsx';
import { Player } from './components/Player.tsx';
import { Queue } from './components/Queue.tsx';
import { SignIn } from './components/SignIn.tsx';
import { fetchMe, guildFromUrl, setGuildInUrl, signOut } from './lib/api.ts';
import { loadPrefs, savePrefs, type Prefs } from './lib/prefs.ts';
import { RoomSocket } from './lib/socket.ts';

type Phase =
  | { name: 'booting' }
  | { name: 'signed-out' }
  | { name: 'picking'; me: Me }
  | { name: 'failed'; error: string }
  | { name: 'live'; me: Me; guildId: string };

const EMPTY_STATE: RoomState = {
  guildId: '',
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

  // --- who are we? ---------------------------------------------------------
  useEffect(() => {
    let cancelled = false;

    fetchMe()
      .then((me) => {
        if (cancelled) return;
        if (!me) {
          setPhase({ name: 'signed-out' });
          return;
        }

        // A shared link carries the server, so following one goes straight in.
        const fromUrl = guildFromUrl();
        const known = fromUrl && me.guilds.some((g) => g.id === fromUrl);
        setPhase(known ? { name: 'live', me, guildId: fromUrl } : { name: 'picking', me });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setPhase({ name: 'failed', error: err instanceof Error ? err.message : String(err) });
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // --- room socket, torn down and rebuilt when the server changes ----------
  const guildId = phase.name === 'live' ? phase.guildId : null;

  useEffect(() => {
    if (!guildId) return;

    setState(EMPTY_STATE);
    const socket = new RoomSocket(guildId, {
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

    return () => {
      socket.close();
      socketRef.current = null;
    };
  }, [guildId]);

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

  const leave = useCallback(() => {
    setGuildInUrl(null);
    setPhase((current) => (current.name === 'live' ? { name: 'picking', me: current.me } : current));
  }, []);

  // --- boot screens --------------------------------------------------------
  if (phase.name === 'booting') {
    return (
      <div className="boot">
        <div className="spinner" />
      </div>
    );
  }

  if (phase.name === 'signed-out') return <SignIn />;

  if (phase.name === 'failed') {
    return (
      <div className="boot">
        <h1>Couldn’t start</h1>
        <p style={{ whiteSpace: 'pre-wrap' }}>{phase.error}</p>
      </div>
    );
  }

  if (phase.name === 'picking') {
    return (
      <GuildPicker
        me={phase.me}
        onPick={(id) => {
          setGuildInUrl(id);
          setPhase({ name: 'live', me: phase.me, guildId: id });
        }}
        onSignOut={() => {
          void signOut().then(() => setPhase({ name: 'signed-out' }));
        }}
      />
    );
  }

  const current = state.current;
  const guild = phase.me.guilds.find((g) => g.id === phase.guildId);

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
        <div className="room-head">
          {guild?.iconUrl && <img className="avatar sm" src={guild.iconUrl} alt="" />}
          <span className="room-name">{guild?.name ?? 'Room'}</span>
          <button type="button" className="ghost" onClick={leave}>
            Change
          </button>
        </div>

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
