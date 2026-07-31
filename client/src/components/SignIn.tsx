import { signInUrl } from '../lib/api.ts';

export function SignIn() {
  return (
    <div className="boot">
      <div className="brand">
        Stream <span>Lurker</span>
      </div>
      <p>
        Watch one Twitch stream together with your Discord server. Anyone can queue channels;
        server moderators decide what plays. Volume and quality stay yours alone.
      </p>
      <a className="btn-discord" href={signInUrl()}>
        Sign in with Discord
      </a>
      <p className="fine">
        Reads your username and which servers you’re in, so it knows where you moderate.
        Nothing is stored — see the privacy policy.
      </p>
    </div>
  );
}
