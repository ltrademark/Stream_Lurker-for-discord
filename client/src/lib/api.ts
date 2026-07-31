import type { Me } from '../../../shared/types.ts';

/**
 * Fetches the signed-in user and the servers they can open a room for.
 * Returns null when not signed in, which is the cue to show the sign-in screen.
 */
export async function fetchMe(): Promise<Me | null> {
  const res = await fetch('/api/me', { credentials: 'same-origin' });
  if (res.status === 401) return null;
  if (!res.ok) throw new Error(`Could not load your account (${res.status}).`);
  return (await res.json()) as Me;
}

export function signInUrl(): string {
  // Carry the current location through OAuth, so following a shared room link
  // lands in that room rather than on the server picker.
  const here = location.pathname + location.search;
  return `/api/auth/login?return=${encodeURIComponent(here)}`;
}

export async function signOut(): Promise<void> {
  await fetch('/api/logout', { method: 'POST', credentials: 'same-origin' });
}

/** The room is in the query string, so a link can be pasted into chat. */
export function guildFromUrl(): string | null {
  return new URLSearchParams(location.search).get('server');
}

export function setGuildInUrl(guildId: string | null): void {
  const url = new URL(location.href);
  if (guildId) url.searchParams.set('server', guildId);
  else url.searchParams.delete('server');
  history.replaceState(null, '', url);
}
