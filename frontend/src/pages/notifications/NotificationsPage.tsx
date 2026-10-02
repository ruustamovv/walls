/**
 * Inbox: matches, results, friend requests, club news. Newest first.
 */
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { Badge, Button, Card, EmptyState, Spinner } from '../../components/ui/primitives.js';
import { useSession } from '../../stores/session.js';

type Item = Awaited<ReturnType<typeof api.notifications>>['notifications'][number];

function target(item: Item): string | null {
  if (item.kind === 'match' || item.kind === 'result') return `/game/${encodeURIComponent(item.body ?? '')}`;
  if (item.kind === 'friend_request') return '/friends';
  return null;
}

export default function NotificationsPage() {
  const { user } = useSession();
  const navigate = useNavigate();
  const [items, setItems] = useState<Item[] | null>(null);

  const load = useCallback(() => {
    api.notifications()
      .then((r) => setItems(r.notifications))
      .catch(() => setItems([]));
  }, []);
  useEffect(() => { if (user !== null) load(); }, [user, load]);

  async function acceptChallenge(n: Item) {
    try {
      const payload = JSON.parse(n.body ?? '{}') as { from?: string; timeControl?: string; mode?: string };
      const g = await api.createGame({
        timeControl: payload.timeControl ?? '3+1',
        ...(payload.from !== undefined ? { opponentId: payload.from } : {}),
      });
      await api.notificationRead(n._id).catch(() => undefined);
      navigate(`/game/${g.id}`);
    } catch { /* keep inbox */ }
  }

  if (user === null) {
    return <EmptyState title="No inbox yet" body="Log in to receive match and social updates." action={<Link to="/login?next=/notifications">Log in</Link>} />;
  }

  return (
    <div style={{ display: 'grid', gap: 16, maxWidth: 640 }}>
      <h1 className="font-display" style={{ margin: 0 }}>Notifications</h1>
      {items === null ? <Spinner /> : items.length === 0 ? (
        <Card><EmptyState title="All caught up" body="Matches, results and friend activity land here." /></Card>
      ) : (
        <Card>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 4 }}>
            {items.map((n) => {
              const to = target(n);
              return (
                <li
                  key={n._id}
                  style={{
                    display: 'flex', gap: 10, alignItems: 'center', padding: '10px 4px',
                    borderTop: '1px solid var(--line)', opacity: n.read ? 0.65 : 1,
                  }}
                >
                  {!n.read && <span aria-label="unread" style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--primary)', flexShrink: 0 }} />}
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: n.read ? 400 : 700 }}>{n.title}</div>
                    <div style={{ color: 'var(--muted)', fontSize: 12 }}>{new Date(n.createdAt).toLocaleString()}</div>
                  </div>
                  <Badge tone="neutral">{n.kind.replace(/_/g, ' ')}</Badge>
                  {n.kind === 'challenge' && <Button size="sm" onClick={() => void acceptChallenge(n)}>Accept 1v1</Button>}
                  {to !== null && <Link to={to} style={{ fontSize: 13 }} onClick={() => { void api.notificationRead(n._id).catch(() => undefined); }}>Open</Link>}
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </div>
  );
}
