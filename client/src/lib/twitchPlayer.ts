/**
 * Loader and typings for Twitch's interactive embed.
 *
 * We use the JS Player API rather than a bare iframe for one specific reason:
 * setVolume/setMuted/setQuality and setChannel all work on a live instance, so a
 * viewer's own volume survives the room switching channels.
 *
 * This loads straight from Twitch. As an ordinary web page there is no sandbox,
 * no CSP to work around, and no URL rewriting — the reason this app is not a
 * Discord Activity. See README for that history.
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

const SCRIPT_URL = 'https://player.twitch.tv/js/embed/v1.js';

let loading: Promise<TwitchPlayerConstructor> | null = null;

export function loadTwitchPlayer(): Promise<TwitchPlayerConstructor> {
  loading ??= load();
  return loading;
}

async function load(): Promise<TwitchPlayerConstructor> {
  if (window.Twitch?.Player) return window.Twitch.Player;

  await new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = SCRIPT_URL;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Could not load ${SCRIPT_URL}`));
    document.head.appendChild(script);
  });

  if (!window.Twitch?.Player) {
    loading = null;
    throw new Error('Twitch embed loaded but window.Twitch.Player is missing.');
  }
  return window.Twitch.Player;
}

/**
 * Domains Twitch must accept as embedders — just wherever this app is served
 * from. Must match a host Twitch will allow; localhost works for development.
 */
export function parentDomains(): string[] {
  return [location.hostname];
}
