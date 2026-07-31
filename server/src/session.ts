import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from './env.js';

export type Session = {
  userId: string;
  name: string;
  avatarUrl: string | null;
  /** Unix ms expiry. */
  exp: number;
};

export const SESSION_COOKIE = 'sl_session';
export const STATE_COOKIE = 'sl_oauth_state';
/** Where to send the user once sign-in completes. */
export const RETURN_COOKIE = 'sl_return';

const TTL_MS = 12 * 60 * 60 * 1000;

function sign(payload: string): string {
  return createHmac('sha256', env.sessionSecret).update(payload).digest('base64url');
}

/**
 * Signed, self-contained session. Deliberately holds only identity — guild
 * permissions live server-side in guilds.ts, so a large guild list never has to
 * fit in a cookie and a client can never edit its own moderator status.
 */
export function issueSession(data: Omit<Session, 'exp'>): string {
  const session: Session = { ...data, exp: Date.now() + TTL_MS };
  const payload = Buffer.from(JSON.stringify(session)).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

export function verifySession(token: string): Session | null {
  const dot = token.lastIndexOf('.');
  if (dot < 1) return null;

  const payload = token.slice(0, dot);
  const provided = Buffer.from(token.slice(dot + 1));
  const expected = Buffer.from(sign(payload));

  // Length check first — timingSafeEqual throws on a mismatch.
  if (provided.length !== expected.length) return null;
  if (!timingSafeEqual(provided, expected)) return null;

  try {
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString()) as Session;
    if (typeof session.exp !== 'number' || session.exp < Date.now()) return null;
    if (!session.userId) return null;
    return session;
  } catch {
    return null;
  }
}

export function cookieHeader(name: string, value: string, maxAgeMs: number): string {
  const parts = [
    `${name}=${value}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.floor(maxAgeMs / 1000)}`,
  ];
  // Secure would make the cookie unusable over plain http://localhost.
  if (env.isProduction) parts.push('Secure');
  return parts.join('; ');
}

export function clearCookieHeader(name: string): string {
  return `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

/** Minimal cookie parser — avoids a dependency for one header. */
export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;

  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 1) continue;
    const name = part.slice(0, eq).trim();
    if (name) out[name] = part.slice(eq + 1).trim();
  }
  return out;
}

export const SESSION_TTL_MS = TTL_MS;
