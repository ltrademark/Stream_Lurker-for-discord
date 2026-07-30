import type { Prefs } from '../lib/prefs.ts';

type Props = {
  prefs: Prefs;
  qualities: string[];
  isModerator: boolean;
  hasCurrent: boolean;
  hasQueue: boolean;
  onPrefsChange: (patch: Partial<Prefs>) => void;
  onSkip: () => void;
  onStop: () => void;
};

/**
 * Everything on the left of this bar is local to the viewer. Everything on the
 * right changes what the room sees, and is moderator-only.
 */
export function Controls({
  prefs,
  qualities,
  isModerator,
  hasCurrent,
  hasQueue,
  onPrefsChange,
  onSkip,
  onStop,
}: Props) {
  return (
    <div className="controls">
      <button
        type="button"
        className="ghost"
        aria-label={prefs.muted ? 'Unmute' : 'Mute'}
        onClick={() => onPrefsChange({ muted: !prefs.muted })}
      >
        {prefs.muted ? '🔇' : '🔊'}
      </button>

      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={prefs.volume}
        aria-label="Volume"
        onChange={(event) =>
          onPrefsChange({ volume: Number(event.target.value), muted: false })
        }
      />

      <label>
        Quality
        <select
          value={prefs.quality}
          onChange={(event) => onPrefsChange({ quality: event.target.value })}
        >
          {/* Populated from the live player; 'auto' is always valid. */}
          {(qualities.length > 0 ? qualities : ['auto']).map((quality) => (
            <option key={quality} value={quality}>
              {quality}
            </option>
          ))}
        </select>
      </label>

      <span className="local-hint">only affects you</span>

      <span className="spacer" />

      <button type="button" className="ghost" onClick={requestFullscreen}>
        ⛶ Fullscreen
      </button>

      {isModerator && (
        <>
          <button type="button" onClick={onSkip} disabled={!hasQueue} title="Play the next channel">
            Skip ▸
          </button>
          <button type="button" onClick={onStop} disabled={!hasCurrent} title="Clear the screen">
            Stop
          </button>
        </>
      )}
    </div>
  );
}

function requestFullscreen(): void {
  const target = document.documentElement;
  if (document.fullscreenElement) {
    void document.exitFullscreen().catch(() => undefined);
    return;
  }
  void target.requestFullscreen?.().catch((err: unknown) => {
    console.warn('[controls] fullscreen refused:', err);
  });
}
