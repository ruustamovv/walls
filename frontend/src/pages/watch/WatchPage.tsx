/**
 * Spectator directory: live games with one-click watch.
 */
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { timeControlName } from '../../lib/format.js';
import { Card, EmptyState, ErrorBox, Spinner } from '../../components/ui/primitives.js';

export default function WatchPage() {
  const [games, setGames] = useState<{ id: string; mode: string; timeControl: string; moveCount: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    api.liveGames()
      .then((res) => { setGames(res.games); setLoading(false); })
      .catch((err: unknown) => { setError(err instanceof Error ? err.message : 'Failed to load live games'); setLoading(false); });
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <h1 style={{ margin: 0 }}>Watch live</h1>
      <Card>
        {loading ? <Spinner />
          : error !== null ? <ErrorBox message={error} onRetry={load} />
          : games.length === 0 ? <EmptyState title="No live games" body="When players are battling, their games appear here." action={<Link to="/play">Start one</Link>} />
          : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 10 }}>
              {games.map((g) => (
                <li key={g.id} style={{ display: 'flex', gap: 12, alignItems: 'center', borderTop: '1px solid var(--line)', paddingTop: 10 }}>
                  <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#dc2626', animation: 'nexus-pulse 1.4s infinite' }} aria-label="live" />
                  <Link to={`/game/${encodeURIComponent(g.id)}`} style={{ fontWeight: 700 }}>
                    {timeControlName(g.timeControl)} · {g.mode}
                  </Link>
                  <span style={{ color: 'var(--muted)', fontSize: 13 }}>{g.moveCount} moves</span>
                </li>
              ))}
            </ul>
          )}
      </Card>
    </div>
  );
}
