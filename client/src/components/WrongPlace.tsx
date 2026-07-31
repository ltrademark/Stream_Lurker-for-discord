/**
 * Shown when the app is loaded inside a Discord Activity iframe rather than a
 * browser tab.
 *
 * This can happen by accident: if the Activity's root URL mapping still points
 * at a tunnel, and that tunnel reaches the server, Discord will happily load the
 * web app inside the sandbox. It renders — and then sign-in dies silently,
 * because the sandbox CSP allows frame-src only for discordsays.com and OAuth
 * has to navigate to discord.com. The symptom is a blank white page with no
 * error, which is genuinely baffling. So: say so plainly instead.
 */
export function WrongPlace() {
  const suggested = 'http://localhost:5173';

  return (
    <div className="boot wide">
      <div className="brand">
        Stream <span>Lurker</span>
      </div>

      <h1>Open this in a browser</h1>

      <p>
        You’re seeing this inside Discord, in the old Activity. Sign-in can’t work here —
        Discord’s sandbox blocks the redirect to <code>discord.com</code>, which is why the
        login screen goes blank.
      </p>

      <p>
        Close this Activity and open the app in a normal browser window instead:
      </p>

      <div className="url-box">{suggested}</div>

      <p className="fine">
        Still seeing the Activity in your App Launcher? Turn off Activities in the Discord
        developer portal under Activities → Settings, or stop the cloudflared tunnel its URL
        mapping points at.
      </p>
    </div>
  );
}
