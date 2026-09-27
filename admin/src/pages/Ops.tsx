/**
 * Operations: live games + queue depth, tournaments, clubs.
 */
import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useSession } from '../stores/session.js';
import { Badge, Button, Card, Empty, H, Spinner } from '../components/ui.js';

export function Ops({ tab }: { tab: 'games' | 'tournaments' | 'clubs' }) {
  if (tab === 'games') return <Games />;
  if (tab === 'tournaments') return <Tournaments />;
  return <Clubs />;
}

function Games() {
  const [queue, setQueue] = useState<Awaited<ReturnType<typeof api.queue>> | null>(null);
  const [recent, setRecent] = useState<Awaited<ReturnType<typeof api.games>>['games']>([]);
  useEffect(() => {
    let live = true;
    api.queue().then((r) => { if (live) setQueue(r); }).catch(() => undefined);
    api.games().then((r) => { if (live) setRecent(r.games); }).catch(() => undefined);
    return () => { live = false; };
  }, []);
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <Card>
        <H>Live operations</H>
        {queue === null ? <Spinner /> : (
          <>
            <p style={{ margin: '0 0 8px', fontSize: 14 }}>
              Queue — memory: <strong>{queue.queue.memory}</strong>
              {' · '}Redis: <strong>{queue.queue.redisOk ? String(queue.queue.redisRanked ?? '?') : 'down'}</strong>
            </p>
            {queue.liveGames.length === 0 ? <p style={{ color: 'var(--muted)', margin: 0 }}>No live games in memory.</p> : (
              <table>
                <thead><tr><th>Game</th><th>Mode</th><th>Moves</th></tr></thead>
                <tbody>
                  {queue.liveGames.map((g) => (
                    <tr key={g.id}>
                      <td><code>{g.id.slice(0, 12)}…</code></td>
                      <td>{g.timeControl} · {g.mode}</td>
                      <td>{g.moveCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </Card>
      <Card>
        <H>Recent games</H>
        {recent.length === 0 ? <Empty title="No games" body="Nothing journaled yet." /> : (
          <table>
            <thead><tr><th>Game</th><th>Mode</th><th>Status</th><th>Moves</th></tr></thead>
            <tbody>
              {recent.map((g) => (
                <tr key={g.id}>
                  <td><code>{g.id.slice(0, 12)}…</code></td>
                  <td>{g.timeControl} · {g.mode}</td>
                  <td><Badge tone="neutral">{g.status}</Badge></td>
                  <td>{g.moveCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

function Tournaments() {
  const me = useSession((s) => s.user);
  const isAdmin = me?.role === 'admin' || me?.role === 'owner';
  const [rows, setRows] = useState<Awaited<ReturnType<typeof api.tournaments>>['tournaments']>([]);
  const load = useCallback(() => {
    api.tournaments().then((r) => setRows(r.tournaments)).catch(() => setRows([]));
  }, []);
  useEffect(() => { load(); }, [load]);
  return (
    <Card>
      <H>Tournaments</H>
      {rows.length === 0 ? <Empty title="No tournaments" body="Founders create them from the player app." /> : (
        <table>
          <thead><tr><th>Title</th><th>Status</th><th>Format</th><th>TC</th><th></th></tr></thead>
          <tbody>
            {rows.map((t) => (
              <tr key={t._id}>
                <td><strong>{t.title}</strong></td>
                <td><Badge tone={t.status === 'LIVE' ? 'good' : t.status === 'FINISHED' ? 'neutral' : 'info'}>{t.status}</Badge></td>
                <td>{t.format}</td>
                <td>{t.timeControl}</td>
                <td>
                  {isAdmin && t.status !== 'FINISHED' && t.status !== 'CANCELLED' && (
                    <Button kind="danger" onClick={() => { void api.tournamentCancel(t._id).then(load); }}>Cancel</Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

function Clubs() {
  const me = useSession((s) => s.user);
  const isAdmin = me?.role === 'admin' || me?.role === 'owner';
  const [rows, setRows] = useState<Awaited<ReturnType<typeof api.clubs>>['clubs']>([]);
  const load = useCallback(() => {
    api.clubs().then((r) => setRows(r.clubs)).catch(() => setRows([]));
  }, []);
  useEffect(() => { load(); }, [load]);
  return (
    <Card>
      <H>Clubs</H>
      {rows.length === 0 ? <Empty title="No clubs" body="Nothing founded yet." /> : (
        <table>
          <thead><tr><th>Name</th><th>Members</th><th></th></tr></thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c._id}>
                <td><strong>{c.name}</strong></td>
                <td>{c.members}</td>
                <td>
                  {isAdmin && (
                    <Button kind="danger" onClick={() => { void api.clubDelete(c._id).then(load); }}>Delete</Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}
