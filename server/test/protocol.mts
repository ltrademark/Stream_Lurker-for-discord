/**
 * End-to-end test of the room protocol. Boots the real server, opens real
 * WebSockets, and asserts the moderator gate holds against a client that lies.
 *
 *   npm test
 *
 * No Discord or Twitch credentials needed — it stubs the Discord ones, seeds the
 * guild store directly, and deliberately omits the Twitch pair so the degraded
 * path gets exercised too.
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { parseChannelInput } from '../../shared/twitch.ts';

const PORT = 3117;
const serverDir = join(dirname(fileURLToPath(import.meta.url)), '..');

process.env.DISCORD_CLIENT_ID = 'test-client-id';
process.env.DISCORD_CLIENT_SECRET = 'test-client-secret';
process.env.SESSION_SECRET = 'test-session-secret-not-a-real-one';
process.env.PORT = String(PORT);
// Set to empty rather than deleted: dotenv skips keys already present in
// process.env, so this stops a real .env from bleeding live Twitch credentials
// into the test and turning it into a network-dependent one.
process.env.TWITCH_CLIENT_ID = '';
process.env.TWITCH_CLIENT_SECRET = '';

const { issueSession, SESSION_COOKIE } = await import(join(serverDir, 'src/session.ts'));
const { rememberGuilds } = await import(join(serverDir, 'src/guilds.ts'));
await import(join(serverDir, 'src/index.ts'));

let failures = 0;
function check(label: string, condition: boolean, detail = ''): void {
  if (!condition) failures++;
  console.log(`${condition ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type Msg = { t: string; [key: string]: unknown };

const GUILD = '900000000000000001';
const OTHER_GUILD = '900000000000000002';

class TestClient {
  ws: WebSocket;
  messages: Msg[] = [];
  closeCode: number | null = null;

  constructor(cookie: string | null) {
    this.ws = new WebSocket(`ws://localhost:${PORT}/ws`, {
      headers: cookie ? { cookie } : {},
    });
    this.ws.on('message', (raw) => this.messages.push(JSON.parse(String(raw)) as Msg));
    this.ws.on('close', (code) => (this.closeCode = code));
    this.ws.on('error', () => undefined);
  }

  open(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws.on('open', () => resolve());
      this.ws.on('close', () => reject(new Error('closed before open')));
      this.ws.on('unexpected-response', (_req, res) => reject(new Error(`HTTP ${res.statusCode}`)));
    });
  }

  send(message: unknown): void {
    this.ws.send(JSON.stringify(message));
  }

  /* eslint-disable @typescript-eslint/no-explicit-any */
  get state(): any {
    const states = this.messages.filter((m) => m.t === 'state');
    return states.length > 0 ? (states[states.length - 1] as any).state : null;
  }

  get errors(): string[] {
    return this.messages.filter((m) => m.t === 'error').map((m) => String(m.message));
  }
}

function cookieFor(userId: string, name: string): string {
  return `${SESSION_COOKIE}=${issueSession({ userId, name, avatarUrl: null, accessToken: 'test-token' })}`;
}

// === channel parsing ========================================================
console.log('\n-- channel input parsing --');
const parseCases: Array<[string, string | null]> = [
  ['xqc', 'xqc'],
  ['  XQC  ', 'xqc'],
  ['@shroud', 'shroud'],
  ['twitch.tv/pokimane', 'pokimane'],
  ['https://www.twitch.tv/summit1g', 'summit1g'],
  ['https://www.twitch.tv/caedrel?tt_content=text_link', 'caedrel'],
  ['http://m.twitch.tv/hasanabi', 'hasanabi'],
  ['https://twitch.tv/day9tv/', 'day9tv'],
  ['some_user_123', 'some_user_123'],
  ['https://www.twitch.tv/videos/123456', null],
  ['https://clips.twitch.tv/AbcDef', null],
  ['https://www.twitch.tv/xqc/clip/Funny-Slug', null],
  ['https://www.twitch.tv/directory/game/Chess', null],
  ['https://www.twitch.tv/', null],
  ['https://youtube.com/watch?v=1', null],
  ['bad name!', null],
  ['', null],
  ['videos', null],
  ['https://www.twitch.tv/moderator/xqc', null],
];

for (const [input, expected] of parseCases) {
  const result = parseChannelInput(input);
  const actual = result.ok ? result.login : null;
  check(`parse ${JSON.stringify(input)}`, actual === expected, result.ok ? result.login : result.error);
}

await sleep(600);

// === transport ==============================================================
console.log('\n-- transport --');
const health = (await fetch(`http://localhost:${PORT}/api/health`).then((r) => r.json())) as {
  ok: boolean;
};
check('health endpoint responds', health.ok === true);

const meAnon = await fetch(`http://localhost:${PORT}/api/me`);
check('/api/me refuses an anonymous caller', meAnon.status === 401, `got ${meAnon.status}`);

const loginRes = await fetch(`http://localhost:${PORT}/api/auth/login`, { redirect: 'manual' });
const loginTo = loginRes.headers.get('location') ?? '';
check('/api/auth/login redirects to Discord', loginTo.startsWith('https://discord.com/oauth2/authorize'));
check('login requests identify+guilds only', loginTo.includes('scope=identify+guilds'), loginTo.slice(0, 120));
check('login sets a CSRF state cookie', (loginRes.headers.get('set-cookie') ?? '').includes('sl_oauth_state'));

const badState = await fetch(`http://localhost:${PORT}/api/auth/callback?code=x&state=y`);
check('callback rejects a mismatched state', badState.status === 400, `got ${badState.status}`);

// === handshake ==============================================================
console.log('\n-- handshake --');
let refusedAnon = false;
try {
  await new TestClient(null).open();
} catch {
  refusedAnon = true;
}
check('socket refuses a caller with no session cookie', refusedAnon);

// Seed the guild store the way a real sign-in would.
rememberGuilds('user-viewer', [
  { id: GUILD, name: 'Test Server', iconUrl: null, isModerator: false },
]);
rememberGuilds('user-mod', [
  { id: GUILD, name: 'Test Server', iconUrl: null, isModerator: true },
]);
rememberGuilds('user-outsider', [
  { id: OTHER_GUILD, name: 'Somewhere Else', iconUrl: null, isModerator: true },
]);

const viewerCookie = cookieFor('user-viewer', 'Viewer');
const modCookie = cookieFor('user-mod', 'Mod');

const forged = new TestClient(`${SESSION_COOKIE}=eyJhIjoxfQ.deadbeef`);
let refusedForged = false;
try {
  await forged.open();
} catch {
  refusedForged = true;
}
check('socket refuses a forged session cookie', refusedForged);

const impatient = new TestClient(viewerCookie);
await impatient.open();
impatient.send({ t: 'skip' });
await sleep(300);
check('commands before hello are rejected', impatient.closeCode === 4002, `code=${impatient.closeCode}`);

// The guild gate: being signed in is not the same as belonging to the room.
const outsider = new TestClient(cookieFor('user-outsider', 'Outsider'));
await outsider.open();
outsider.send({ t: 'hello', guildId: GUILD });
await sleep(300);
check(
  'a non-member cannot join another server’s room',
  outsider.closeCode === 4004,
  `code=${outsider.closeCode}`,
);

// === queue behaviour ========================================================
console.log('\n-- queue --');
const viewer = new TestClient(viewerCookie);
await viewer.open();
viewer.send({ t: 'hello', guildId: GUILD });
await sleep(300);
check('viewer receives initial state', viewer.state !== null);
check('state carries the guild', viewer.state?.guildId === GUILD);
check('metadata reports disabled without Twitch creds', viewer.state?.metadataEnabled === false);

viewer.send({ t: 'queue:add', input: 'https://www.twitch.tv/xqc?x=1' });
await sleep(300);
check('first add auto-plays', viewer.state?.current?.login === 'xqc');
check('queue stays empty on first add', viewer.state?.queue.length === 0);

viewer.send({ t: 'queue:add', input: 'pokimane' });
await sleep(300);
check('second add appends, does not steal the screen', viewer.state?.current?.login === 'xqc');
check('queue holds one entry', viewer.state?.queue.length === 1);

viewer.send({ t: 'queue:add', input: 'XQC' });
await sleep(300);
check(
  'duplicate channel is refused',
  viewer.errors.some((e) => e.includes('already playing')),
);

// === the moderator gate =====================================================
// The point of this block: a non-moderator client sending the privileged
// messages directly, bypassing the UI that would never render the buttons.
console.log('\n-- moderator gate --');
const queuedId = viewer.state.queue[0].id as string;

viewer.send({ t: 'play:now', id: queuedId });
await sleep(300);
check(
  'non-moderator play:now is refused',
  viewer.errors.some((e) => e.includes('Only server moderators')),
);
check('refused play:now changed nothing', viewer.state?.current?.login === 'xqc');

viewer.send({ t: 'skip' });
viewer.send({ t: 'stop' });
viewer.send({ t: 'queue:remove', id: queuedId });
viewer.send({ t: 'queue:reorder', id: queuedId, index: 0 });
await sleep(300);
check('non-moderator skip/stop/remove/reorder all refused', viewer.state?.current?.login === 'xqc');
check('queue untouched by refused commands', viewer.state?.queue.length === 1);

console.log('\n-- moderator override --');
const mod = new TestClient(modCookie);
await mod.open();
mod.send({ t: 'hello', guildId: GUILD });
await sleep(300);
check('both participants visible', mod.state?.participants.length === 2);
check(
  'moderator flag comes from the guild store, not the client',
  mod.messages.some((m) => m.t === 'state' && (m as any).you.isModerator === true),
);

mod.send({ t: 'play:now', id: queuedId });
await sleep(300);
check('moderator play:now switches the stream', mod.state?.current?.login === 'pokimane');
check('displaced stream returns to the front of the queue', mod.state?.queue[0]?.login === 'xqc');
check('the viewer sees the switch too', viewer.state?.current?.login === 'pokimane');

mod.send({ t: 'skip' });
await sleep(300);
check('moderator skip advances', mod.state?.current?.login === 'xqc');
check('queue drained by skip', mod.state?.queue.length === 0);

mod.send({ t: 'stop' });
await sleep(300);
check('stop clears the screen', mod.state?.current === null);
check('stop returns the stream to the queue rather than losing it', mod.state?.queue[0]?.login === 'xqc');

// === room isolation =========================================================
console.log('\n-- room isolation --');
const elsewhere = new TestClient(cookieFor('user-outsider', 'Outsider'));
await elsewhere.open();
elsewhere.send({ t: 'hello', guildId: OTHER_GUILD });
await sleep(300);
check('a different server gets its own empty room', elsewhere.state?.queue.length === 0);
check('and does not see the other room’s stream', elsewhere.state?.current === null);
elsewhere.ws.close();

// === reconnection ===========================================================
console.log('\n-- reconnection --');
viewer.ws.close();
mod.ws.close();
await sleep(500);

const rejoin = new TestClient(viewerCookie);
await rejoin.open();
rejoin.send({ t: 'hello', guildId: GUILD });
await sleep(300);
check('queue survives a brief disconnect', rejoin.state?.queue.length === 1);
check('only one participant after rejoin', rejoin.state?.participants.length === 1);
rejoin.ws.close();

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
