# Watch Twitch Together — a Discord Activity

Everyone in a voice channel watches **one** Twitch stream together. Anyone can add
channels to a shared queue; server moderators decide what jumps the line. Volume,
mute and quality are per viewer — your changes are never pushed to anyone else.

- Shared queue, synced live over a WebSocket
- Auto-plays the first add, auto-advances when a stream ends
- Live badge, title, game, viewer count and uptime from the Twitch API
- Per-viewer volume / mute / quality, remembered across sessions
- Near-black UI with Twitch purple accents

---

## Before it will run

You need two applications registered, and four values in a `.env` file.

### 1. A Discord application

Go to the [Developer Portal](https://discord.com/developers/applications) → **New
Application**.

- **OAuth2** → copy the **Client ID** and **Client Secret**.
- **Activities** → **Settings** → enable Activities.
- **Activities** → **URL Mappings** → add the rows in the table below.

> **URL Mappings must be ordered longest-prefix-first.** The portal matches in
> the order listed, so `/twitch-player` has to appear above `/`.

| Prefix           | Target                  | Why                                    |
| ---------------- | ----------------------- | -------------------------------------- |
| `/twitch-player` | `player.twitch.tv`      | the embed script and the player itself |
| `/twitch-gql`    | `gql.twitch.tv`         | the player's own API calls             |
| `/twitch-usher`  | `usher.ttvnw.net`       | HLS playlist lookup                    |
| `/twitch-spade`  | `spade.twitch.tv`       | the player's telemetry (it retries hard if blocked) |
| `/ttvnw/{subdomain}` | `{subdomain}.ttvnw.net` | video segments                     |
| `/twitch-cdn`    | `static-cdn.jtvnw.net`  | channel avatars                        |
| `/discord-cdn`   | `cdn.discordapp.com`    | participant avatars                    |
| `/`              | *your tunnel or host*   | this app                               |

### 2. A Twitch application

[dev.twitch.tv/console/apps](https://dev.twitch.tv/console/apps) → **Register Your
Application**. OAuth redirect URL can be `http://localhost` — it is never used, as
the server only uses the client-credentials grant for public stream metadata.

Copy the **Client ID** and generate a **Client Secret**.

This pair is optional. Without it the app still runs; channel names just aren't
validated and cards show no title, game, viewer count or live badge.

### 3. `.env`

```bash
cp .env.example .env
```

Fill in `DISCORD_CLIENT_ID`, `VITE_DISCORD_CLIENT_ID` (the same value again — Vite
only exposes `VITE_`-prefixed variables to browser code), `DISCORD_CLIENT_SECRET`,
the Twitch pair, and a `SESSION_SECRET`:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## Running it

```bash
npm install
npm run dev          # API on :3000, Vite on :5173
```

In a second terminal, expose Vite — **not** the API server. Vite forwards `/api`
and `/ws` to port 3000, and tunnelling it keeps hot reload working:

```bash
cloudflared tunnel --url http://localhost:5173
```

Set `TUNNEL=1` when you start the dev server so hot reload dials the tunnel
instead of localhost:

```bash
TUNNEL=1 npm run dev
```

Paste the `https://….trycloudflare.com` URL into the `/` URL mapping in the
Developer Portal and save. Then in Discord: join a voice channel → rocket button
in the call controls → pick the app off the shelf.

cloudflared hands out a new hostname every run, so the `/` mapping needs
re-pasting each time you restart the tunnel.

### Production

```bash
npm run build
npm start            # serves client/dist and the socket from one process on :3000
```

One process, in-memory room state, no database. Point the `/` URL mapping at
wherever it's hosted.

---

## Verifying it works

```bash
npm test             # 45 checks: input parsing, handshake, queue, moderator gate
npm run typecheck
```

`npm test` needs no credentials. It boots the real server, opens real sockets, and
includes a client that sends the privileged messages directly — the UI never
renders those buttons for a non-moderator, but the server has to refuse them
anyway, so that's what gets asserted.

What tests can't cover is the sandbox, which only exists inside the Discord
client. For that, use two accounts (a second on mobile or in a browser) and check:

1. A non-moderator's add plays for both of you.
2. Their second add appends to the queue instead of taking over the screen.
3. A moderator's **Play now** switches both screens, and the displaced stream
   goes back to the front of the queue.
4. One account at 20% volume / 480p does not change the other's audio at all.
5. Reload one account — the queue is intact and their volume comes back.
6. Both leave and rejoin within 60 seconds — the queue survived.
7. The devtools console shows **no `blocked:csp`** errors.

### If the player doesn't load

Run the spike, which isolates the sandbox question from the rest of the app:

```bash
npm run dev:spike                                  # :3000, zero dependencies
cloudflared tunnel --url http://localhost:3000
```

Point the `/` mapping at that tunnel and launch it in a voice channel. It tries
the embed script and a raw nested iframe, probes which URL mappings are actually
live, and logs every CSP violation with the origin that was blocked.

The known hard part: Discord's proxy only permits requests to your own proxy
origin. `patchUrlMappings()` rewrites requests our own code makes, but it cannot
reach inside the nested Twitch document — so Twitch's player calling
`gql.twitch.tv` and `*.ttvnw.net` at absolute URLs is the thing to watch. That's
what the mapping table above is for, and what the spike measures.

---

## Layout

```
shared/           types.ts, twitch.ts — wire types and the channel parser,
                  imported by both sides so validation can't drift
server/src/
  index.ts        Express + static client, strips the /.proxy prefix
  routes/token.ts OAuth code exchange, resolves moderator status server-side
  rooms.ts        room state, queue mutations, metadata polling, auto-advance
  ws.ts           socket handshake and the single authorisation gate
  twitch.ts       Helix client (app access token, batched lookups)
  session.ts      HMAC-signed session tokens
client/src/
  App.tsx         boot, socket wiring, state plumbing
  components/     Player, Controls, NowPlaying, Queue, AddChannel, Participants
  lib/            discord.ts (SDK + URL mappings), socket.ts, prefs.ts,
                  twitchPlayer.ts (embed loader + typings)
spike/            throwaway sandbox probe, no dependencies
```

### Design notes

**Moderator status is resolved server-side** from `GET /users/@me/guilds`, reading
the caller's computed guild permission bitfield (`Administrator`, `Manage Server`,
`Manage Channels` or `Move Members`). That avoids needing a bot token in the
server. It's guild-level rather than per-voice-channel, which is the deliberate
simplicity trade. The result is baked into an HMAC-signed session token, and the
socket re-checks it on every mutating message — a client claiming to be a
moderator is simply ignored.

One caveat inherent to Activities: `instanceId` and `guildId` come from the SDK on
the client, and Discord offers no server-side way to verify that an OAuth code
belongs to a given activity instance. Someone who is an admin of *some* guild
could therefore claim moderator in a room they name. The blast radius is one voice
channel of people who already trust each other enough to be in it.

**Full state snapshots** go out on every change rather than deltas. The state is
tiny, and it makes reconnection trivial — say hello again and the next broadcast
brings you current, with nothing to replay.

**Rooms are reaped 60 seconds after the last socket closes**, so a reload or a
brief drop doesn't wipe the queue.

**One player instance for the activity's lifetime.** Channel switches go through
`setChannel()` rather than remounting the iframe, so a viewer's own volume and
quality survive the room changing streams.

---

## Deliberately not built

**Channel points can't work, and no amount of Twitch OAuth changes that.** Twitch
awards no channel points on *any* site's embedded player — it's a standing,
unshipped [feature request](https://twitch.uservoice.com/forums/932221-channel-points/suggestions/42463210-obtain-channel-points-on-embedded-players),
not something specific to this app. The Helix channel-points endpoints are all
broadcaster-scoped, so there is no viewer-side endpoint to earn or redeem with.
And independently: the player is served through `<app_id>.discordsays.com/.proxy/…`,
so Twitch never receives the viewer's session cookies — the embed is structurally
anonymous. Drops are blocked for the same reasons.

Viewer-count credit is separate: embed plays generally do count, but as one
anonymous viewer via Discord's proxy IP. Treat it as likely, not guaranteed.

**Twitch OAuth chat** is deferred, not rejected. A Twitch login would buy one
genuinely good feature — chatting as yourself from inside the activity — and
building the chat UI against our own server (relaying to Twitch IRC server-side)
would sidestep the nested-iframe problem entirely, unlike the embedded chat
iframe. Worth picking up once the video surface is proven.

**Also out of scope:** VODs and clips (live channels only, which is what removes
any need for cross-viewer seek/pause syncing), persistence across activity
sessions, and publishing to the public activity shelf.

**Per-viewer *latency* control isn't possible** on the sanctioned player — the
official embed API exposes no low-latency toggle. Per-viewer *quality* is, and is
built.
