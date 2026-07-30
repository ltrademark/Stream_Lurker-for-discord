import { DiscordSDK, patchUrlMappings } from '@discord/embedded-app-sdk';

const CLIENT_ID = import.meta.env.VITE_DISCORD_CLIENT_ID as string | undefined;

export type Auth = {
  sdk: DiscordSDK;
  /** Signed session token for the WebSocket handshake. */
  session: string;
  instanceId: string;
};

/**
 * Discord puts frame_id and instance_id on the query string when it launches an
 * activity. Their absence means we're being viewed in a plain browser tab, and
 * there is no SDK to talk to.
 */
export function isInsideDiscord(): boolean {
  return new URLSearchParams(location.search).has('frame_id');
}

/**
 * Tells the sandbox how to reach Twitch. Needed because Twitch's embed script
 * builds its own iframe pointing at an absolute player.twitch.tv URL — we can't
 * rewrite that by hand, so patchSrcAttributes does it for us.
 *
 * These prefixes must match the URL Mappings configured in the Developer
 * Portal, or the requests will be blocked rather than redirected.
 */
let mappingsApplied = false;

export function applyUrlMappings(): void {
  // patchUrlMappings rewrites fetch/WebSocket/XHR and src attributes in place,
  // so calling it twice (StrictMode) would double-wrap the globals.
  if (mappingsApplied) return;
  mappingsApplied = true;

  patchUrlMappings(
    [
      { prefix: '/twitch-player', target: 'player.twitch.tv' },
      { prefix: '/twitch-gql', target: 'gql.twitch.tv' },
      { prefix: '/twitch-usher', target: 'usher.ttvnw.net' },
      { prefix: '/twitch-spade', target: 'spade.twitch.tv' },
      { prefix: '/twitch-cdn', target: 'static-cdn.jtvnw.net' },
      { prefix: '/discord-cdn', target: 'cdn.discordapp.com' },
    ],
    { patchFetch: true, patchWebSocket: true, patchXhr: true, patchSrcAttributes: true },
  );
}

export async function authenticate(): Promise<Auth> {
  if (!CLIENT_ID) {
    throw new Error(
      'VITE_DISCORD_CLIENT_ID is not set. Add it to .env (same value as DISCORD_CLIENT_ID).',
    );
  }

  const sdk = new DiscordSDK(CLIENT_ID);
  await sdk.ready();

  const { code } = await sdk.commands.authorize({
    client_id: CLIENT_ID,
    response_type: 'code',
    state: '',
    prompt: 'none',
    // `guilds` is what lets the server read the caller's guild permissions and
    // decide whether they are a moderator.
    scope: ['identify', 'guilds'],
  });

  const res = await fetch('/.proxy/api/token', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      code,
      instanceId: sdk.instanceId,
      guildId: sdk.guildId,
    }),
  });

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Token exchange failed (${res.status}).`);
  }

  const { access_token, session } = (await res.json()) as {
    access_token: string;
    session: string;
  };

  await sdk.commands.authenticate({ access_token });

  return { sdk, session, instanceId: sdk.instanceId };
}
