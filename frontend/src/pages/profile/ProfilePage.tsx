/**
 * Player profile: real ratings, win/loss, recent games from Mongo.
 */
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { Avatar, Badge, Button, Card, DivisionBadge, EmptyState, ErrorBox, Skeleton, Spinner, TextInput } from '../../components/ui/primitives.js';
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
      <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
        <Avatar name={username} size={60} />
        <div>
          <h1 className="font-display" style={{ margin: 0 }}>{username}</h1>
          <div style={{ display: 'flex', gap: 8, marginTop: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            {data === null
              ? <Skeleton width={140} />
              : data.ratings.length > 0 && <DivisionBadge rating={Math.max(...data.ratings.map((r) => r.rating))} />}
            {data?.degraded === true && <Badge tone="warn">database offline</Badge>}
            {user !== null && user.username !== username && <ReportUserButton username={username} />}
          </div>
        </div>
      </div>

      {error !== null ? <ErrorBox message={error} onRetry={() => setData(null)} />
        : data === null ? <Spinner />
        : (
          <>
            {data.stats !== undefined && (data.stats.seatGames[0] + data.stats.seatGames[1] > 0) && (
              <Card>
                <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 14 }}>
                  <span>
                    First seat <strong className="font-mono">{data.stats.seatWins[0]}/{data.stats.seatGames[0]}</strong>
                  </span>
                  <span>
                    Second seat <strong className="font-mono">{data.stats.seatWins[1]}/{data.stats.seatGames[1]}</strong>
                  </span>
                  {data.stats.streak > 1 && (
                    <Badge tone={data.stats.streakWon ? 'good' : 'bad'}>
                      {data.stats.streakWon ? '🔥' : '❄'} {data.stats.streak} {data.stats.streakWon ? 'wins' : 'losses'} in a row
                    </Badge>
                  )}
                </div>
              </Card>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 12 }}>
              {data.ratings.map((r) => (
                <Card key={r.mode}>
                  <div style={{ textTransform: 'capitalize', color: 'var(--muted)', fontSize: 13, fontWeight: 700 }}>{r.mode}</div>
                  <div className="font-mono" style={{ fontSize: 26, fontWeight: 800 }}>{r.rating}</div>
                  <div style={{ margin: '6px 0' }}><DivisionBadge rating={r.rating} /></div>
                  <div style={{ fontSize: 13, color: 'var(--muted)' }}>
                    peak {r.peak} · {r.games} games · {r.wins}W/{r.losses}L
                  </div>
                </Card>
              ))}
              {data.ratings.length === 0 && (
                <Card><EmptyState title="No ratings yet" body="Play your first game to earn a rating." action={<Link to="/play">Play</Link>} /></Card>
              )}
            </div>
            <RatingChart username={username} mode="blitz" />
            <Card>
              <h2 style={{ margin: '0 0 10px' }}>Recent games</h2>
              {data.recentGames.length === 0
                ? <p style={{ color: 'var(--muted)', margin: 0 }}>No games recorded yet.</p>
                : (
                  <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
                    {data.recentGames.map((gm) => (
                      <li key={gm.id} style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 14, borderTop: '1px solid var(--line)', paddingTop: 8 }}>
                        <Link
                          to={gm.status === 'FINISHED' ? `/replay/${encodeURIComponent(gm.id)}` : `/game/${encodeURIComponent(gm.id)}`}
                          style={{ fontWeight: 700 }}
                        >
                          {gm.timeControl} · {gm.mode}
                        </Link>
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

function ReportUserButton({ username }: { username: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [done, setDone] = useState(false);
  if (!open) {
    return <Button size="sm" variant="subtle" onClick={() => setOpen(true)}>Report</Button>;
  }
  if (done) return <span style={{ color: 'var(--muted)', fontSize: 13 }}>Reported — thanks.</span>;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void api.report('user', username, reason).then(() => setDone(true));
      }}
      style={{ display: 'flex', gap: 6, alignItems: 'center' }}
    >
      <TextInput value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (min 3 chars)" aria-label="report reason" maxLength={1000} style={{ width: 220 }} />
      <Button size="sm" type="submit" disabled={reason.trim().length < 3}>Send</Button>
    </form>
  );
}

function RatingChart({ username, mode }: { username: string; mode: string }) {
  const [points, setPoints] = useState<{ after: number; at: string }[] | null>(null);
  useEffect(() => {
    let live = true;
    api.ratingHistory(username, mode)
      .then((r) => { if (live) setPoints(r.points); })
      .catch(() => { if (live) setPoints([]); });
    return () => { live = false; };
  }, [username, mode]);
  if (points === null || points.length < 2) return null;
  const W = 560;
  const H = 120;
  const PAD = 8;
  const values = points.map((p) => p.after);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(1, max - min);
  const xy = points.map((p, i) => {
    const x = PAD + (i / (points.length - 1)) * (W - PAD * 2);
    const y = H - PAD - ((p.after - min) / span) * (H - PAD * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return (
    <Card>
      <h2 className="font-display" style={{ margin: '0 0 4px', textTransform: 'capitalize' }}>{mode} rating</h2>
      <p style={{ color: 'var(--muted)', fontSize: 13, margin: '0 0 8px' }}>
        {min} → {max} across {points.length} games
      </p>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${mode} rating history`} style={{ width: '100%', height: 'auto', display: 'block' }}>
        <polyline points={xy.join(' ')} fill="none" stroke="var(--primary)" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
        {xy.map((pt, i) => {
          const [cx, cy] = pt.split(',');
          return <circle key={i} cx={cx} cy={cy} r={3} fill="var(--primary)" opacity={i === xy.length - 1 ? 1 : 0.35} />;
        })}
      </svg>
    </Card>
  );
}
