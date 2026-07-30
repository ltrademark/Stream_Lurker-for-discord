/**
 * Loader and typings for Twitch's interactive embed. We use the JS Player API
 * rather than a bare iframe for one specific reason: setVolume/setMuted/
 * setQuality and setChannel all work on a live instance, so a viewer's own
 * volume survives the room switching channels.
 */

export type TwitchPlayerInstance = {
  play(): void;
  pause(): void;
  setChannel(channel: string): void;
  setVolume(level: number): void;
  getVolume(): number;
  setMuted(muted: boolean): void;
  getMuted(): boolean;
  setQuality(quality: string): void;
  getQuality(): string;
  getQualities(): Array<{ name: string; group: string; bitrate?: number }>;
  addEventListener(event: string, handler: () => void): void;
  removeEventListener(event: string, handler: () => void): void;
};

type TwitchPlayerConstructor = {
  new (
    elementId: string,
    options: {
      channel: string;
      parent: string[];
      width: string | number;
      height: string | number;
      muted?: boolean;
      autoplay?: boolean;
    },
  ): TwitchPlayerInstance;
  READY: string;
  PLAYING: string;
  PAUSE: string;
  ENDED: string;
  ONLINE: string;
  OFFLINE: string;
  PLAYBACK_BLOCKED: string;
};

declare global {
  interface Window {
    Twitch?: { Player: TwitchPlayerConstructor };
  }
}

/**
 * The Discord docs disagree about whether activity requests carry the /.proxy
 * prefix, so try both and use whichever actually yields the Twitch namespace.
 */
const SCRIPT_PATHS = [
  '/.proxy/twitch-player/js/embed/v1.js',
  '/twitch-player/js/embed/v1.js',
];

let loading: Promise<TwitchPlayerConstructor> | null = null;

export function loadTwitchPlayer(): Promise<TwitchPlayerConstructor> {
  loading ??= load();
  return loading;
}

async function load(): Promise<TwitchPlayerConstructor> {
  if (window.Twitch?.Player) return window.Twitch.Player;

  const failures: string[] = [];

  for (const src of SCRIPT_PATHS) {
    try {
      await injectScript(src);
    } catch {
      failures.push(`${src} (blocked or 404)`);
      continue;
    }

    // A mapping that isn't configured falls through to our own server, which
    // answers with JSON — the script "loads" but defines nothing.
    if (window.Twitch?.Player) return window.Twitch.Player;
    failures.push(`${src} (loaded but window.Twitch was undefined)`);
  }

  loading = null;
  throw new Error(
    `Could not load the Twitch embed through the activity proxy.\n${failures.join('\n')}\n` +
      'Check the URL mapping /twitch-player -> player.twitch.tv in the Developer Portal.',
  );
}

function injectScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(src));
    document.head.appendChild(script);
  });
}

/**
 * Domains Twitch must accept as embedders. Inside Discord the page origin is
 * already <app_id>.discordsays.com, so it comes straight off location, and
 * discord.com covers the outer frame.
 */
export function parentDomains(): string[] {
  const host = location.hostname;
  return host.endsWith('.discordsays.com') ? [host, 'discord.com'] : [host];
}
