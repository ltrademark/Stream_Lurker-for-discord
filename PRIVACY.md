# Privacy Policy — Stream Lurker

_Last updated: 30 July 2026_

Stream Lurker is a website that lets a Discord server watch one Twitch stream
together. This policy describes exactly what it touches. It is short because the
app does very little.

## The short version

There is no database. Nothing you do in Stream Lurker is written to disk on the
server, and nothing is shared with anyone. All state lives in the server's memory
and is discarded 60 seconds after the last person leaves a room.

## What the app receives from Discord

When you sign in, Discord asks your permission to share two things (the
`identify` and `guilds` OAuth scopes):

- **Your Discord account** — user ID, username, display name, and avatar. Used to
  label who added a channel to the queue and to show the participant list.
- **Your list of Discord servers, with your permissions in each** — used to show
  which servers you can open a room for, and to work out where you hold moderator
  permissions. Server names, icons and that yes/no answer are held in memory for
  the life of your session and never written to disk.

Your Discord ID, display name and avatar URL are packed into a signed session
cookie that expires after 12 hours. Your moderator status is deliberately **not**
in the cookie — it is held server-side, so it cannot be edited by anyone holding
the cookie. The cookie is HttpOnly, so page scripts cannot read it either.

## What the app receives from Twitch

**Nothing about you.** Stream Lurker never asks you to log in to Twitch and never
receives a Twitch identity, session, or cookie of yours.

The server queries Twitch's public API using its own application credentials to
look up channel display names, avatars, live status, stream titles, categories,
viewer counts, and start times. That is public information about broadcasters, not
about viewers.

Video and audio play through Twitch's official embedded player, loaded directly
from Twitch in your browser. Twitch therefore sees your IP address and sets its
own cookies, exactly as visiting twitch.tv would — that is between you and Twitch,
and is governed by their privacy notice. Twitch never receives your Discord
identity from us.

## What is stored on your own device

Your volume, mute state, and video quality are saved in your browser's
`localStorage`, on your device only. They are never sent to the server and never
visible to other participants — that is the entire point of them. Clearing your
browser storage resets them.

## What is stored on the server

Only in memory, only while a room is open:

- Per room: the channel currently playing and the queue of channels waiting
- For each entry, which participant added it and when
- The list of people currently connected, with the fields listed above
- Per signed-in user: your server list and where you moderate, until the session
  expires or you sign out

When the last participant leaves a room, a 60-second grace period runs (so a page
reload doesn't wipe the queue) and then the entire room is deleted. A server
restart clears everything immediately.

## What the app does not do

- No analytics, telemetry, tracking pixels, or advertising
- No selling, sharing, or transferring of data to third parties
- No logging of your messages, voice, video, or screen
- No reading of Discord messages — the app has no bot and no message access
- No tracking cookies. The one cookie set is the sign-in session described above
- No persistence of any kind between server restarts

## Server logs

The server prints operational lines to its console — for example that a display
name joined a server's room, or that a channel was queued. These are ordinary
process logs, not an analytics pipeline. They are not written to a database and
are lost when the process restarts. Whoever hosts the instance you are using
controls those logs.

## Third parties

Stream Lurker sits between two services with their own policies, which govern
their own handling of your data:

- [Discord Privacy Policy](https://discord.com/privacy)
- [Twitch Privacy Notice](https://www.twitch.tv/p/legal/privacy-notice/)

## Your choices

Because nothing is retained, there is nothing to export or delete. Signing out
clears your session and your cached server list immediately; the room disappears
once everyone has left. To remove the app's access to your Discord account
entirely, visit Discord **User Settings → Authorized Apps** and revoke it.

## Children

Stream Lurker is not directed at children. It requires a Discord account, which is
subject to Discord's own minimum age requirements.

## Changes

Any change to this policy will be committed to this repository, so its full
history is visible in the git log.

## Contact

Open an issue on this repository.
