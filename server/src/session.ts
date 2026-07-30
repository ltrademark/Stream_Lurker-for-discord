import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from './env.js';

export type Session = {
  userId: string;
  name: string;
  avatarUrl: string | null;
  instanceId: string;
  isModerator: boolean;
  /** Unix ms expiry. */
  exp: number;
};

const TTL_MS = 12 * 60 * 60 * 1000;

function sign(payload: string): string {
  return createHmac('sha256', env.sessionSecret).update(payload).digest('base64url');
}

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
    if (!session.userId || !session.instanceId) return null;
    return session;
  } catch {
    return null;
  }
}
