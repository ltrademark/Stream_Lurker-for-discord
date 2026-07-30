import type { Participant } from '../../../shared/types.ts';

type Props = {
  participants: Participant[];
  connected: boolean;
};

export function Participants({ participants, connected }: Props) {
  return (
    <div className="participants">
      {participants.map((person) => (
        <div
          key={person.id}
          className={person.isModerator ? 'mod-dot' : undefined}
          title={person.isModerator ? `${person.name} (moderator)` : person.name}
        >
          {person.avatarUrl ? (
            <img className="avatar sm" src={person.avatarUrl} alt={person.name} />
          ) : (
            <div className="avatar sm" />
          )}
        </div>
      ))}

      <span className="spacer" style={{ flex: 1 }} />

      <span className="local-hint">
        {connected ? `${participants.length} watching` : 'reconnecting…'}
      </span>
    </div>
  );
}
