import type { QueueItem } from '../../../shared/types.ts';

type Props = {
  item: QueueItem | null;
  metadataEnabled: boolean;
};

export function NowPlaying({ item, metadataEnabled }: Props) {
  if (!item) {
    return <div className="empty-note">Nothing is playing yet.</div>;
  }

  const { meta } = item;
  const name = meta?.displayName ?? item.login;

  return (
    <div className="now-playing">
      {meta?.avatarUrl ? (
        <img className="avatar" src={meta.avatarUrl} alt="" />
      ) : (
        <div className="avatar" />
      )}

      <div className="body">
        <div className="title-row">
          <span className="channel-name" title={name}>
            {name}
          </span>
          {metadataEnabled && meta && (
            <span className={meta.live ? 'badge-live' : 'badge-offline'}>
              {meta.live ? 'Live' : 'Offline'}
            </span>
          )}
        </div>

        {meta?.title && <div className="stream-title">{meta.title}</div>}

        <div className="stream-meta">
          {meta?.game && <span>{meta.game}</span>}
          {typeof meta?.viewers === 'number' && (
            <span>{meta.viewers.toLocaleString()} watching</span>
          )}
          {meta?.startedAt && <span>up {formatUptime(meta.startedAt)}</span>}
          <span>added by {item.addedBy.name}</span>
        </div>
      </div>
    </div>
  );
}

export function formatUptime(startedAt: string): string {
  const minutes = Math.max(0, Math.floor((Date.now() - Date.parse(startedAt)) / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}
