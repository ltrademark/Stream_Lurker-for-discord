import type { Me } from '../../../shared/types.ts';

type Props = {
  me: Me;
  onPick: (guildId: string) => void;
  onSignOut: () => void;
};

/**
 * One room per Discord server, so "who moderates" needs no invention — it is
 * whoever already moderates that server.
 */
export function GuildPicker({ me, onPick, onSignOut }: Props) {
  return (
    <div className="boot wide">
      <div className="brand">
        Stream <span>Lurker</span>
      </div>
      <p>Pick a server. Everyone you share the link with lands in the same room.</p>

      <ul className="guild-list">
        {me.guilds.map((guild) => (
          <li key={guild.id}>
            <button type="button" onClick={() => onPick(guild.id)}>
              {guild.iconUrl ? (
                <img className="avatar" src={guild.iconUrl} alt="" />
              ) : (
                <div className="avatar placeholder">{guild.name.slice(0, 1).toUpperCase()}</div>
              )}
              <span className="name">{guild.name}</span>
              {guild.isModerator && <span className="mod-tag">moderator</span>}
            </button>
          </li>
        ))}
      </ul>

      <div className="signed-in">
        {me.avatarUrl && <img className="avatar sm" src={me.avatarUrl} alt="" />}
        <span>{me.name}</span>
        <button type="button" className="ghost" onClick={onSignOut}>
          Sign out
        </button>
      </div>
    </div>
  );
}
