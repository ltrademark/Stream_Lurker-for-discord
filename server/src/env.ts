import { config } from 'dotenv';
import { randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// .env lives at the repo root, one level above server/.
config({ path: join(dirname(fileURLToPath(import.meta.url)), '../../.env') });

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(
      `\n  Missing ${name}. Copy .env.example to .env and fill it in.` +
        `\n  See README.md for where each value comes from.\n`,
    );
    process.exit(1);
  }
  return value;
}

const sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret) {
  console.warn(
    '  SESSION_SECRET is unset — using a random one for this process only.\n' +
      '  Sessions will not survive a restart. Set it in .env for real use.',
  );
}

const port = Number(process.env.PORT) || 3000;

export const env = {
  discordClientId: required('DISCORD_CLIENT_ID'),
  discordClientSecret: required('DISCORD_CLIENT_SECRET'),

  /**
   * Where this app is reachable, used to build the OAuth redirect_uri. Must
   * match a redirect exactly as registered in the Discord developer portal.
   */
  publicBaseUrl: (process.env.PUBLIC_BASE_URL ?? `http://localhost:${port}`).replace(/\/$/, ''),

  /** Both required together, or metadata is disabled and the app degrades. */
  twitchClientId: process.env.TWITCH_CLIENT_ID ?? '',
  twitchClientSecret: process.env.TWITCH_CLIENT_SECRET ?? '',

  sessionSecret: sessionSecret ?? randomBytes(32).toString('hex'),
  port,
  isProduction: process.env.NODE_ENV === 'production',
};

export const metadataEnabled = Boolean(env.twitchClientId && env.twitchClientSecret);

if (!metadataEnabled) {
  console.warn(
    '  TWITCH_CLIENT_ID/SECRET unset — running without Twitch metadata.\n' +
      '  Channel names will not be validated and cards will show no title,\n' +
      '  game, viewer count or live badge.',
  );
}
