import { useEffect, useState } from 'react';

/**
 * Shown when the app is loaded inside a Discord Activity iframe rather than a
 * browser tab.
 *
 * This happens by accident: if the Activity's root URL mapping still points at a
 * tunnel, and that tunnel reaches this server, Discord will happily load the web
 * app inside the sandbox. It renders — and then sign-in dies silently, because
 * the sandbox CSP allows frame-src only for discordsays.com while OAuth has to
 * navigate to discord.com. The symptom is a blank white page with no error.
 *
 * The address is fetched rather than hardcoded: only the server knows where it
 * is actually reachable, and guessing localhost is wrong for anyone running the
 * server on a different machine.
 */
export function WrongPlace() {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    // /api works in here — it is the OAuth *navigation* the sandbox blocks, not
    // same-origin requests through the proxy.
    fetch('/api/config')
      .then((res) => (res.ok ? res.json() : null))
      .then((config: { publicBaseUrl?: string } | null) => setUrl(config?.publicBaseUrl ?? null))
      .catch(() => setUrl(null));
  }, []);

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

      <p>Close this Activity and open the app in a normal browser tab instead:</p>

      {url ? (
        <div className="url-box">{url}</div>
      ) : (
        <div className="url-box muted">wherever this server is reachable</div>
      )}

      <p className="fine">
        To stop the Activity appearing in your App Launcher, turn off Activities in the
        Discord developer portal under Activities → Settings.
      </p>
    </div>
  );
}
