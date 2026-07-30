import { useEffect, useRef, useState } from 'react';
import type { Prefs } from '../lib/prefs.ts';
import {
  loadTwitchPlayer,
  parentDomains,
  type TwitchPlayerInstance,
} from '../lib/twitchPlayer.ts';

const MOUNT_ID = 'twitch-player-mount';

type Props = {
  login: string | null;
  prefs: Prefs;
  onUnmute: () => void;
  onQualities: (qualities: string[]) => void;
  onOffline: (login: string) => void;
};

/**
 * Wraps a single Twitch player instance for the lifetime of the activity.
 * Channel changes go through setChannel() rather than remounting, so a viewer's
 * volume and quality survive the room switching streams.
 */
export function Player({ login, prefs, onUnmute, onQualities, onOffline }: Props) {
  const playerRef = useRef<TwitchPlayerInstance | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [dismissedUnmute, setDismissedUnmute] = useState(false);

  // Latest values for use inside long-lived event handlers.
  const loginRef = useRef(login);
  loginRef.current = login;
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  const onOfflineRef = useRef(onOffline);
  onOfflineRef.current = onOffline;
  const onQualitiesRef = useRef(onQualities);
  onQualitiesRef.current = onQualities;

  // --- create the instance once, the first time there's something to play ---
  // Guarded by a ref rather than by `status`, deliberately: keying the effect on
  // its own state makes StrictMode's mount/unmount/mount cancel the in-flight
  // load and then skip the retry, and no player ever appears.
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current || !login) return;
    startedRef.current = true;
    setStatus('loading');

    loadTwitchPlayer()
      .then((Player) => {
        const instance = new Player(MOUNT_ID, {
          // login may have moved on while the script was loading.
          channel: loginRef.current ?? login,
          parent: parentDomains(),
          width: '100%',
          height: '100%',
          // Browsers refuse unmuted autoplay; the overlay unmutes on a gesture.
          muted: true,
          autoplay: true,
        });

        instance.addEventListener(Player.READY, () => {
          applyPrefs(instance, prefsRef.current);
          try {
            onQualitiesRef.current(instance.getQualities().map((q) => q.name));
          } catch {
            // Qualities aren't always populated at READY; the PLAYING handler retries.
          }
          setStatus('ready');
        });

        instance.addEventListener(Player.PLAYING, () => {
          try {
            onQualitiesRef.current(instance.getQualities().map((q) => q.name));
          } catch {
            /* not fatal */
          }
        });

        instance.addEventListener(Player.OFFLINE, () => {
          const current = loginRef.current;
          if (current) onOfflineRef.current(current);
        });

        instance.addEventListener(Player.PLAYBACK_BLOCKED, () => {
          setDismissedUnmute(false);
        });

        playerRef.current = instance;
      })
      .catch((err: unknown) => {
        console.error('[player]', err);
        setError(err instanceof Error ? err.message : String(err));
        setStatus('error');
        // Allow a retry if the room switches channel later.
        startedRef.current = false;
      });
  }, [login]);

  // --- channel switches ----------------------------------------------------
  useEffect(() => {
    const instance = playerRef.current;
    if (!instance || !login) return;
    instance.setChannel(login);
  }, [login]);

  // --- per-viewer preferences ---------------------------------------------
  useEffect(() => {
    const instance = playerRef.current;
    if (!instance || status !== 'ready') return;
    applyPrefs(instance, prefs);
  }, [prefs, status]);

  const showUnmute = status === 'ready' && prefs.muted && !dismissedUnmute && Boolean(login);

  return (
    <div className="player-frame">
      <div id={MOUNT_ID} />

      {status === 'error' && (
        <div className="player-empty">
          <div className="glyph">!</div>
          <strong>The Twitch player couldn’t load</strong>
          <p style={{ whiteSpace: 'pre-wrap', fontSize: 12, maxWidth: '46ch' }}>{error}</p>
        </div>
      )}

      {!login && status !== 'error' && (
        <div className="player-empty">
          <div className="glyph">▶</div>
          <strong>Nothing playing</strong>
          <p>Add a Twitch channel and it starts here for everyone.</p>
        </div>
      )}

      {showUnmute && (
        <button
          type="button"
          className="unmute-overlay"
          onClick={() => {
            setDismissedUnmute(true);
            onUnmute();
          }}
        >
          <span className="glyph">🔊</span>
          Click to unmute
          <small>Your volume is yours alone — nobody else hears your changes.</small>
          <small
            role="button"
            tabIndex={0}
            style={{ textDecoration: 'underline', marginTop: 4 }}
            onClick={(event) => {
              event.stopPropagation();
              setDismissedUnmute(true);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.stopPropagation();
                setDismissedUnmute(true);
              }
            }}
          >
            or keep it muted
          </small>
        </button>
      )}
    </div>
  );
}

function applyPrefs(instance: TwitchPlayerInstance, prefs: Prefs): void {
  try {
    instance.setVolume(prefs.volume);
    instance.setMuted(prefs.muted);
    if (prefs.quality && prefs.quality !== instance.getQuality()) {
      instance.setQuality(prefs.quality);
    }
  } catch (err) {
    // The player rejects calls made before it finishes initialising; the next
    // prefs change or the READY handler will apply them.
    console.warn('[player] could not apply preferences yet:', err);
  }
}
