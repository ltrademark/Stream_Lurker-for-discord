# Privacy Policy — Stream Lurker

_Last updated: 30 July 2026_

Stream Lurker is a Discord Activity that lets people in a voice channel watch one
Twitch stream together. This policy describes exactly what it touches. It is short
because the app does very little.

## The short version

There is no database. Nothing you do in Stream Lurker is written to disk on the
server, and nothing is shared with anyone. All state lives in the server's memory
and is discarded 60 seconds after the last person leaves the activity.

## What the app receives from Discord

When you launch the activity, Discord asks your permission to share two things
(the `identify` and `guilds` OAuth scopes):

- **Your Discord account** — user ID, username, display name, and avatar. Used to
  label who added a channel to the queue and to show the participant list.
- **Your list of Discord servers, with your permissions in each** — used once, at
  launch, to work out whether you have moderator permissions in the server you're
  currently in. Only the answer to that single yes/no question is kept; the list
  itself is discarded immediately and never stored.

Your Discord ID, display name, avatar URL, the activity instance you're in, and
that moderator yes/no are packed into a signed session token that expires after 12
hours. It exists so the server can recognise your connection without re-asking
Discord. It is not readable or usable by anyone else.

## What the app receives from Twitch

**Nothing about you.** Stream Lurker never asks you to log in to Twitch and never
receives a Twitch identity, session, or cookie of yours.

The server queries Twitch's public API using its own application credentials to
look up channel display names, avatars, live status, stream titles, categories,
viewer counts, and start times. That is public information about broadcasters, not
about viewers.

Video and audio play through Twitch's official embedded player. Because the player
is loaded through Discord's activity proxy, Twitch does not receive your Discord
identity, and Discord's proxy is what conceals your IP address from Twitch.

## What is stored on your own device

Your volume, mute state, and video quality are saved in your browser's
`localStorage`, on your device only. They are never sent to the server and never
visible to other participants — that is the entire point of them. Clearing your
browser storage resets them.

## What is stored on the server

Only in memory, only while the activity is open:

- The channel currently playing and the queue of channels waiting
- For each entry, which participant added it and when
- The list of people currently connected, with the fields listed above

When the last participant disconnects, a 60-second grace period runs (so a page
reload doesn't wipe the queue) and then the entire room is deleted. A server
restart clears everything immediately.

## What the app does not do

- No analytics, telemetry, tracking pixels, or advertising
- No selling, sharing, or transferring of data to third parties
- No logging of your messages, voice, video, or screen
- No reading of Discord messages — the app has no bot and no message access
- No cookies of its own
- No persistence of any kind between activity sessions

## Server logs

The server prints operational lines to its console — for example that a display
name joined an activity instance, or that a channel was queued. These are ordinary
process logs, not an analytics pipeline. They are not written to a database and
are lost when the process restarts. Whoever hosts the instance you are using
controls those logs.

## Third parties

Stream Lurker sits between two services with their own policies, which govern
their own handling of your data:

- [Discord Privacy Policy](https://discord.com/privacy)
- [Twitch Privacy Notice](https://www.twitch.tv/p/legal/privacy-notice/)

## Your choices

Because nothing is retained, there is nothing to export or delete. Closing the
activity ends the session; the room disappears once everyone has left. To remove
the app's access to your Discord account entirely, visit Discord **User Settings →
Authorized Apps** and revoke it.

## Children

Stream Lurker is not directed at children. It requires a Discord account, which is
subject to Discord's own minimum age requirements.

## Changes

Any change to this policy will be committed to this repository, so its full
history is visible in the git log.

## Contact

Open an issue on this repository.
