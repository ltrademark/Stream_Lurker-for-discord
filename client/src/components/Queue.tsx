import { useState } from 'react';
import type { QueueItem } from '../../../shared/types.ts';

type Props = {
  items: QueueItem[];
  isModerator: boolean;
  onPlayNow: (id: string) => void;
  onRemove: (id: string) => void;
  onReorder: (id: string, index: number) => void;
};

/**
 * Moderator-only affordances are not rendered at all for other viewers, rather
 * than rendered disabled. The server enforces the same rule regardless, so this
 * is purely about not advertising controls that won't work.
 */
export function Queue({ items, isModerator, onPlayNow, onRemove, onReorder }: Props) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  if (items.length === 0) {
    return (
      <div className="empty-note">
        Queue is empty. Anyone can add a channel — moderators decide what jumps the line.
      </div>
    );
  }

  return (
    <ul className="queue">
      {items.map((item, index) => {
        const name = item.meta?.displayName ?? item.login;
        const classes = [
          'queue-item',
          dragId === item.id ? 'dragging' : '',
          overIndex === index && dragId !== item.id ? 'drop-target' : '',
        ]
          .filter(Boolean)
          .join(' ');

        return (
          <li
            key={item.id}
            className={classes}
            draggable={isModerator}
            onDragStart={() => setDragId(item.id)}
            onDragOver={(event) => {
              if (!isModerator || !dragId) return;
              event.preventDefault();
              setOverIndex(index);
            }}
            onDragEnd={() => {
              setDragId(null);
              setOverIndex(null);
            }}
            onDrop={(event) => {
              if (!isModerator || !dragId) return;
              event.preventDefault();
              if (dragId !== item.id) onReorder(dragId, index);
              setDragId(null);
              setOverIndex(null);
            }}
          >
            {isModerator && (
              <span className="grip" aria-hidden="true">
                ⋮⋮
              </span>
            )}

            {item.meta?.avatarUrl ? (
              <img className="avatar sm" src={item.meta.avatarUrl} alt="" />
            ) : (
              <div className="avatar sm" />
            )}

            <div className="info">
              <div className="name" title={name}>
                {name}
                {item.meta && !item.meta.live && (
                  <span className="badge-offline" style={{ marginLeft: 6 }}>
                    Offline
                  </span>
                )}
              </div>
              <div className="sub">
                {item.meta?.game ? `${item.meta.game} · ` : ''}
                {item.addedBy.name}
              </div>
            </div>

            {isModerator && (
              <div className="actions">
                <button
                  type="button"
                  className="ghost"
                  title="Play now"
                  aria-label={`Play ${name} now`}
                  onClick={() => onPlayNow(item.id)}
                >
                  ▶
                </button>
                <button
                  type="button"
                  className="ghost"
                  title="Remove"
                  aria-label={`Remove ${name}`}
                  onClick={() => onRemove(item.id)}
                >
                  ✕
                </button>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
