/**
 * Playback preferences are strictly per-viewer: they live in this browser and
 * are never sent to the server. Changing your volume must not touch anybody
 * else's, which is the whole point.
 */

const KEY = 'twitch-activity:prefs';

export type Prefs = {
  volume: number;
  muted: boolean;
  /** Twitch quality name ('auto', '720p60', …). */
  quality: string;
};

const DEFAULTS: Prefs = { volume: 0.5, muted: true, quality: 'auto' };

export function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };

    const parsed = JSON.parse(raw) as Partial<Prefs>;
    return {
      volume:
        typeof parsed.volume === 'number' && parsed.volume >= 0 && parsed.volume <= 1
          ? parsed.volume
          : DEFAULTS.volume,
      // Always start muted regardless of what was stored — browsers block
      // unmuted autoplay, and the overlay restores the stored volume on click.
      muted: true,
      quality: typeof parsed.quality === 'string' ? parsed.quality : DEFAULTS.quality,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function savePrefs(prefs: Prefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    // Private browsing or a full quota. Preferences just won't persist.
  }
}
