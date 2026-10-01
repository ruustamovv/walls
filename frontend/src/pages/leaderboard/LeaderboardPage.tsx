/**
 * Leaderboard per rating mode, backed by the real ratings collection.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { Avatar, Badge, Card, DivisionBadge, EmptyState, ErrorBox, Spinner, Tabs } from '../../components/ui/primitives.js';

const MODES = ['bullet', 'blitz', 'rapid', 'classic', 'casual'] as const;

export default function LeaderboardPage() {
  const [mode, setMode] = useState<(typeof MODES)[number]>('blitz');
  const [entries, setEntries] = useState<{ rank: number; username: string; rating: number; games: number; wins: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [degraded, setDegraded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api.leaderboard(mode).then((res) => {
      if (cancelled) return;
      setEntries(res.entries);
      setDegraded(res.degraded === true);
      setLoading(false);
    }).catch((err: unknown) => {
      if (cancelled) return;
      setError(err instanceof Error ? err.message : 'Failed to load leaderboard');
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [mode]);

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <h1 className="font-display" style={{ margin: 0 }}>Leaderboard</h1>
        {degraded && <Badge tone="warn">database offline — showing cached shape</Badge>}
      </div>
      <Tabs tabs={MODES} active={mode} onChange={setMode} />
      <Card>
        {loading ? <Spinner />
          : error !== null ? <ErrorBox message={error} onRetry={() => setMode((m) => m)} />
          : entries.length === 0 ? <EmptyState title="No rated games yet" body="Finish a game and your rating will appear here." action={<Link to="/play">Play now</Link>} />
          : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 15 }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--muted)', fontSize: 13 }}>
                  <th style={{ padding: '8px 4px' }}>#</th>
                  <th>Player</th>
                  <th>Rating</th>
                  <th>Games</th>
                  <th>Win %</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={`${e.rank}-${e.username}`} style={{ borderTop: '1px solid var(--line)' }}>
                    <td style={{ padding: '8px 4px', color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>{e.rank}</td>
                    <td>
                      <Link to={`/profile/${encodeURIComponent(e.username)}`} style={{ fontWeight: 700, display: 'inline-flex', gap: 8, alignItems: 'center', textDecoration: 'none' }}>
                        <Avatar name={e.username} size={26} />{e.username}
                      </Link>
                      <div style={{ marginTop: 4 }}><DivisionBadge rating={e.rating} /></div>
                    </td>
                    <td className="font-mono" style={{ fontWeight: 700 }}>{e.rating}</td>
                    <td style={{ fontVariantNumeric: 'tabular-nums' }}>{e.games}</td>
                    <td style={{ fontVariantNumeric: 'tabular-nums' }}>{e.games > 0 ? Math.round((e.wins / e.games) * 100) : 0}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
      </Card>
    </div>
  );
}
