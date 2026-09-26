/**
 * Player profile: real ratings, win/loss, recent games from Mongo.
 */
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { Badge, Card, EmptyState, ErrorBox, Spinner } from '../../components/ui/primitives.js';
import { useSession } from '../../stores/session.js';

export default function ProfilePage() {
  const { id = '' } = useParams();
  const { user } = useSession();
  const username = id === 'me' ? (user?.username ?? '') : id;
  const [data, setData] = useState<Awaited<ReturnType<typeof api.profile>> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (username === '') return;
    let cancelled = false;
    setData(null);
    setError(null);
    api.profile(username).then((res) => { if (!cancelled) setData(res); })
      .catch((err: unknown) => { if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load profile'); });
    return () => { cancelled = true; };
  }, [username]);

  if (username === '') {
    return <EmptyState title="Log in to see your profile" body="Your ratings, games and progress live here." action={<Link to="/login?next=/profile/me">Log in</Link>} />;
  }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <span aria-hidden style={{
          width: 52, height: 52, borderRadius: '50%', background: 'var(--primary)', color: '#fff',
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 22,
        }}>
          {username.slice(0, 1).toUpperCase()}
        </span>
        <div>
          <h1 style={{ margin: 0 }}>{username}</h1>
          {data?.degraded === true && <Badge tone="warn">database offline</Badge>}
        </div>
      </div>

      {error !== null ? <ErrorBox message={error} onRetry={() => setData(null)} />
        : data === null ? <Spinner />
        : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 12 }}>
              {data.ratings.map((r) => (
                <Card key={r.mode}>
                  <div style={{ textTransform: 'capitalize', color: 'var(--muted)', fontSize: 13, fontWeight: 700 }}>{r.mode}</div>
                  <div style={{ fontSize: 26, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{r.rating}</div>
                  <div style={{ fontSize: 13, color: 'var(--muted)' }}>
                    peak {r.peak} · {r.games} games · {r.wins}W/{r.losses}L
                  </div>
                </Card>
              ))}
              {data.ratings.length === 0 && (
                <Card><EmptyState title="No ratings yet" body="Play your first game to earn a rating." action={<Link to="/play">Play</Link>} /></Card>
              )}
            </div>
            <Card>
              <h2 style={{ margin: '0 0 10px' }}>Recent games</h2>
              {data.recentGames.length === 0
                ? <p style={{ color: 'var(--muted)', margin: 0 }}>No games recorded yet.</p>
                : (
                  <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
                    {data.recentGames.map((gm) => (
                      <li key={gm.id} style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 14, borderTop: '1px solid var(--line)', paddingTop: 8 }}>
                        <Link to={`/game/${encodeURIComponent(gm.id)}`} style={{ fontWeight: 700 }}>{gm.timeControl} · {gm.mode}</Link>
                        <Badge tone={gm.status === 'FINISHED' ? 'neutral' : 'info'}>{gm.status.toLowerCase()}</Badge>
                        {gm.result !== null && gm.result.winnerSeat !== null && (
                          <span style={{ color: 'var(--muted)' }}>winner: seat {gm.result.winnerSeat + 1} ({gm.result.reason})</span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
            </Card>
          </>
        )}
    </div>
  );
}
