# Stream Lurker

Watch one Twitch stream together with your Discord server. Anyone can add
channels to a shared queue; server moderators decide what plays. Volume, mute and
quality are per viewer — your changes are never pushed to anyone else.

One room per Discord server. Sign in, pick a server, share the link.

- Shared queue, synced live over a WebSocket
- Auto-plays the first add, auto-advances when a stream ends
- Live badge, title, game, viewer count and uptime from the Twitch API
- Per-viewer volume / mute / quality, remembered across sessions
- Moderator rights come from your real Discord server permissions
- Near-black UI with Twitch purple accents

> **Why this is a web app and not a Discord Activity** — it was one, right up
> until Twitch's bot detection stopped it. See [the postmortem](#appendix-why-not-a-discord-activity).

---

## Setup

Two applications to register, and a `.env`.

### 1. Discord application

[Developer Portal](https://discord.com/developers/applications) → your app:

- **OAuth2** → copy the **Client ID** and **Client Secret**
- **OAuth2 → Redirects** → add the URL your app is served from plus
  `/api/auth/callback`. It must match `PUBLIC_BASE_URL` exactly:
  - local development: `http://localhost:5173/api/auth/callback`
  - deployed: `https://your-domain/api/auth/callback`

No bot, no Activities settings, no URL mappings, no installation contexts. Just
OAuth.

### 2. Twitch application

[dev.twitch.tv/console/apps](https://dev.twitch.tv/console/apps) → **Register Your
Application**.

| Field | Value |
| --- | --- |
| OAuth Redirect URLs | `http://localhost` (required but unused) |
| Category | Application Integration |
| **Client Type** | **Confidential** — a Public client cannot hold a secret, and the server needs one |

The redirect really is unused: the server only uses the client-credentials grant
for public stream metadata, so no viewer ever logs in to Twitch.

This pair is optional. Without it the app still runs; channel names just aren't
validated and cards show no title, game, viewer count or live badge.

### 3. `.env`

```bash
cp .env.example .env
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"   # SESSION_SECRET
```

---

## Running it

```bash
npm install
npm run dev      # API on :3000, Vite on :5173
```

Open **http://localhost:5173**. Vite forwards `/api` and `/ws` to the API server,
and Twitch accepts `localhost` as an embed parent — so local development needs no
tunnel and no public hostname.

### Production

```bash
npm run build
npm start        # serves client/dist and the socket from one process on :3000
```

One process, in-memory room state, no database. Set `PUBLIC_BASE_URL` to the
public URL and add the matching redirect in the Discord portal.

---

## Verifying it works

```bash
npm test         # 52 checks: parsing, OAuth flow, handshake, queue, moderator gate
npm run typecheck
```

`npm test` needs no credentials and makes no network calls. It boots the real
server, opens real WebSockets, and includes clients that misbehave on purpose — a
forged session cookie, commands sent before joining, a user claiming a server they
don't belong to, and a non-moderator sending the privileged messages directly. The
UI never renders those buttons, but the server has to refuse them anyway, so
that's what gets asserted.

For the rest, use two accounts (a second browser profile works):

1. Both sign in and open the same server. Both appear in the participant row.
2. A non-moderator adds a channel → it plays for both.
3. Their second add appends to the queue instead of taking over the screen.
4. A moderator's **Play now** switches both screens, and the displaced stream goes
   back to the front of the queue.
5. One account at 20% volume / 480p does not change the other's audio at all.
6. Reload one account → the queue is intact and their volume comes back.
7. Both leave and rejoin within 60 seconds → the queue survived.
8. Paste a `/videos/123` URL → clean rejection naming the reason.

---

## Layout

```
shared/           types.ts, twitch.ts — wire types and the channel parser,
                  imported by both sides so validation can't drift
server/src/
  index.ts        Express + static client
  routes/auth.ts  Discord OAuth, guild permission resolution
  guilds.ts       per-user guild + moderator cache
  session.ts      HMAC-signed session cookie
  rooms.ts        room state, queue mutations, metadata polling, auto-advance
  ws.ts           socket handshake and the single authorisation gate
  twitch.ts       Helix client (app access token, batched lookups)
client/src/
  App.tsx         sign-in → server picker → room
  components/     Player, Controls, NowPlaying, Queue, AddChannel,
                  Participants, SignIn, GuildPicker
  lib/            api.ts, socket.ts, prefs.ts, twitchPlayer.ts
spike/            the Discord Activity investigation — see the appendix
```

### Design notes

**Moderator status is resolved once, at sign-in**, from Discord's own computed
guild permission bitfield (`Administrator`, `Manage Server`, `Manage Channels` or
`Move Members`) — no bot token required. It's cached server-side rather than put
in the cookie, so a large guild list can't blow the size limit and a client can
never edit its own flag. The socket re-checks it on every mutating message.

**Rooms are keyed by guild**, and joining one requires membership the server
verified at sign-in. Naming someone else's server gets the connection closed.

**Full state snapshots** go out on every change rather than deltas. The state is
tiny, and it makes reconnection trivial — say hello again and the next broadcast
brings you current, with nothing to replay.

**Rooms are reaped 60 seconds after the last socket closes**, so a reload or a
brief drop doesn't wipe the queue.

**One player instance for the page's lifetime.** Channel switches go through
`setChannel()` rather than remounting the iframe, so a viewer's own volume and
quality survive the room changing streams.

---

## Deliberately not built

**Channel points can't work.** Twitch awards no channel points on *any* site's
embedded player — a standing, unshipped
[feature request](https://twitch.uservoice.com/forums/932221-channel-points/suggestions/42463210-obtain-channel-points-on-embedded-players),
not something specific to this app. The Helix channel-points endpoints are all
broadcaster-scoped, so there's no viewer-side endpoint to earn or redeem with.
Drops are blocked for the same reasons.

**Twitch OAuth chat** is deferred, not rejected. A Twitch login would buy one
genuinely good feature — chatting as yourself from inside the app.

**Also out of scope:** VODs and clips (live channels only, which removes any need
for cross-viewer seek/pause syncing), and persistence across restarts.

**Per-viewer *latency* control isn't possible** — the official embed API exposes
no low-latency toggle. Per-viewer *quality* is, and is built.

---

## Appendix: why not a Discord Activity

This started as a Discord Activity, so it would run inside the voice call. That
version is preserved in `spike/` — a standalone, dependency-free probe you can run
with `node spike/server.mjs`. It is not part of the app.

Discord Activities run in a sandboxed iframe whose CSP only permits requests to
your own proxy origin, with external hosts declared as URL Mappings. Getting
Twitch's player through that took a server-side rewriting layer, and it worked
further than expected:

- Every asset host mapped, including video segment hosts. Discord's `{parameter}`
  matches a single label and won't span dots, so `video-weaver.iad02.hls.ttvnw.net`
  needs one parameter per label — proven with a control probe.
- Player code, stylesheets, fonts, GraphQL and inline scripts all loaded.
- Discord's CSP permits `media-src` and `worker-src` from your own origin, so MSE
  playback and HLS workers were allowed.
- Twitch never refused `discordsays.com` as an embed parent.

**The blocker was Twitch's bot detection, not Discord's sandbox.** Twitch gates
playback tokens on Kasada (`k.twitchcdn.net`), whose job is to detect exactly this
technique. Routing URLs requires patching `fetch`, `XMLHttpRequest`, `WebSocket`,
`Worker`, `sendBeacon` and element property setters — and patched natives are one
of the first things Kasada checks. The thing that made it work is the thing that
made it detectable, so there was no version of it that both routed traffic and
passed the check.

As an ordinary web page there is no sandbox, no CSP to work around, no URL
rewriting, and no bot-detection fight. Twitch's official embed simply works. The
queue, sync, moderation and per-viewer controls carried over unchanged.
