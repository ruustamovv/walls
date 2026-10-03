/**
 * Profile: header, tabs (Overview/Games/Stats/Friends), rating cards with
 * sparklines, streak + theme rail, friends grid, game archive. Real data only.
 */
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { Avatar, Badge, Button, Card, DivisionBadge, EmptyState, ErrorBox, Spinner, TextInput } from '../../components/ui/primitives.js';
import { Icon, type IconName } from '../../components/ui/icons.js';
import { useSession } from '../../stores/session.js';
import GameBoard from '../../components/game/GameBoard.js';
import type { GameState } from '../../../../engine/typescript/core/types.js';

type Tab = 'overview' | 'games' | 'stats' | 'friends';
type Profile = Awaited<ReturnType<typeof api.profile>>;

const emptyBoard: GameState = {
  size: 9, wallsPerPlayer: 10, turn: 0,
  pawns: [{ r: 8, c: 4 }, { r: 0, c: 4 }], walls: [], wallsRemaining: [10, 10],
  winner: null, isOver: false, moveNumber: 0, lastAction: null, rulesVersion: '1.0.0',
};

export default function ProfilePage() {
  const { id = '' } = useParams();
  const { user } = useSession();
  const username = id === 'me' ? (user?.username ?? '') : id;
  const self = user !== null && user.username === username;
  const [data, setData] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('overview');
  const [challenged, setChallenged] = useState<string | null>(null);
  const [friendCount, setFriendCount] = useState<number | null>(null);

  useEffect(() => {
    if (username === '') return;
    let cancelled = false;
    setData(null);
    setError(null);
    api.profile(username).then((res) => { if (!cancelled) setData(res); })
      .catch((err: unknown) => { if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load profile'); });
    return () => { cancelled = true; };
  }, [username]);

  useEffect(() => {
    if (!self) {
      setFriendCount(null);
      return;
    }
    let live = true;
    api.friends().then((r) => { if (live) setFriendCount(r.friends.length); }).catch(() => undefined);
    return () => { live = false; };
  }, [self, username]);

  if (username === '') {
    return <EmptyState title="Log in to see your profile" body="Ratings, games and progress live here." action={<Link to="/login?next=/profile/me">Log in</Link>} />;
  }

  const best = data !== null && data.ratings.length > 0 ? Math.max(...data.ratings.map((r) => r.rating)) : 0;

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <Avatar name={username} size={72} frame={data?.frame} />
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <h1 className="font-display" style={{ margin: 0 }}>{username}</h1>
            {best > 0 && <DivisionBadge rating={best} />}
            {self && <Badge tone="good">online</Badge>}
            {data?.degraded === true && <Badge tone="warn">offline</Badge>}
          </div>
          {data !== null && (
            <p style={{ color: 'var(--muted)', fontSize: 13, margin: '6px 0 0' }}>
              Joined {data.joinedAt !== undefined ? new Date(data.joinedAt).toLocaleDateString() : '—'}
              {friendCount !== null && <> · {friendCount} friends</>}
              {' · '}{data.views ?? 0} views
              {data.fairPlay !== undefined && <> · Fair play {data.fairPlay.score}</>}
            </p>
          )}
        </div>
        {self && <Link to="/settings"><Button size="sm" variant="ghost">Edit profile</Button></Link>}
        {!self && user !== null && (
          <>
            <ReportUserButton username={username} />
            {challenged !== null
              ? <Badge tone="good">{challenged}</Badge>
              : <Button size="sm" onClick={() => { void api.challenge(username, '3+1', 'ranked').then(() => setChallenged('Challenge sent')).catch((e: unknown) => setChallenged(e instanceof Error ? e.message : 'Failed')); }}>Challenge 1v1</Button>}
          </>
        )}
        <LevelChip username={username} />
      </div>

      {error !== null ? <ErrorBox message={error} />
        : data === null ? <Spinner />
        : (
          <>
            <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--line)' }}>
              {(['overview', 'games', 'stats', 'friends'] as Tab[]).map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  style={{
                    background: 'none', border: 'none', padding: '10px 14px', fontWeight: 800, fontSize: 14,
                    textTransform: 'capitalize', cursor: 'pointer', color: tab === t ? 'var(--ink)' : 'var(--muted)',
                    borderBottom: tab === t ? '2px solid var(--good)' : '2px solid transparent',
                  }}
                >
                  {t}
                </button>
              ))}
            </div>
            {tab === 'overview' && <Overview data={data} self={self} />}
            {tab === 'games' && <Archive data={data} />}
            {tab === 'stats' && <Stats data={data} />}
            {tab === 'friends' && <FriendsTab self={self} />}
          </>
        )}
    </div>
  );
}

function useHistories(username: string, modes: string[]) {
  const [maps, setMaps] = useState<Record<string, { after: number }[]>>({});
  useEffect(() => {
    let live = true;
    Promise.all(modes.map((m) => api.ratingHistory(username, m).then((r) => ({ m, points: r.points })).catch(() => ({ m, points: [] as { after: number; at: string }[] }))))
      .then((rows) => {
        if (!live) return;
        const next: Record<string, { after: number }[]> = {};
        for (const r of rows) next[r.m] = r.points;
        setMaps(next);
      })
      .catch(() => undefined);
    return () => { live = false; };
  }, [username]);
  return maps;
}

function Spark({ points }: { points: { after: number }[] }) {
  if (points.length < 2) return <div style={{ height: 34 }} />;
  const values = points.map((p) => p.after);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(1, max - min);
  const W = 150;
  const H = 34;
  const xy = points.map((p, i) => `${(4 + (i / (points.length - 1)) * (W - 8)).toFixed(1)},${(H - 4 - ((p.after - min) / span) * (H - 8)).toFixed(1)}`);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="rating trend" style={{ width: '100%', height: 34, display: 'block' }}>
      <polyline points={xy.join(' ')} fill="none" stroke="var(--primary)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

const MODE_ICON: Record<string, IconName> = { bullet: 'rocket', blitz: 'bolt', rapid: 'clock', classic: 'shield', casual: 'bot' };

function Overview({ data, self }: { data: Profile; self: boolean }) {
  const modes = data.ratings.filter((r) => ['bullet', 'blitz', 'rapid'].includes(r.mode));
  const hist = useHistories(data.username, modes.map((r) => r.mode));
  const streak = data.puzzles?.streak ?? 0;
  return (
    <div className="profile-grid">
      <div style={{ display: 'grid', gap: 16, alignContent: 'start' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 12 }}>
          {modes.map((r) => {
            const pts = hist[r.mode] ?? [];
            const delta = pts.length >= 2 ? pts[pts.length - 1]!.after - pts[0]!.after : 0;
            return (
              <Card key={r.mode}>
                <div style={{ color: 'var(--muted)', fontSize: 12, fontWeight: 700, textTransform: 'capitalize', display: 'flex', gap: 6, alignItems: 'center' }}>
                  <Icon name={MODE_ICON[r.mode] ?? 'bolt'} size={15} /> {r.mode}
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                  <span className="font-mono" style={{ fontSize: 26, fontWeight: 800 }}>{r.rating}</span>
                  {delta !== 0 && (
                    <span style={{ fontSize: 12, fontWeight: 800, color: delta > 0 ? 'var(--good)' : 'var(--bad)' }}>
                      {delta > 0 ? '↑' : '↓'} {Math.abs(delta)}
                    </span>
                  )}
                </div>
                <Spark points={pts} />
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>{r.games} games</div>
              </Card>
            );
          })}
          {modes.length === 0 && (
            <Card><EmptyState title="No ratings yet" body="Play to earn a rating." action={<Link to="/play">Play</Link>} /></Card>
          )}
        </div>
        <Archive data={data} limit={5} />
      </div>
      <div style={{ display: 'grid', gap: 16, alignContent: 'start' }}>
        {streak > 0 && (
          <Card>
            <div style={{ fontWeight: 800, display: 'flex', gap: 8, alignItems: 'center' }}>
              <span style={{ color: 'var(--warn)' }}><Icon name="flame" size={20} /></span> {streak}-day streak
            </div>
            <div style={{ fontSize: 13, color: 'var(--muted)' }}>Daily puzzles solved in a row.</div>
          </Card>
        )}
        <Card>
          <div style={{ fontWeight: 800, marginBottom: 8 }}>Board theme</div>
          <div style={{ maxWidth: 220 }}>
            <GameBoard state={emptyBoard} humanSeats={[]} interactive={false} onMove={() => undefined} onWall={() => undefined} />
          </div>
        </Card>
        {self && <FriendsPreview />}
      </div>
      <style>{`@media (min-width: 900px) { .profile-grid { display: grid; grid-template-columns: minmax(0,1.4fr) minmax(0,1fr); gap: 16px; align-items: start; } } @media (max-width: 899px) { .profile-grid { display: grid; gap: 16px; } }`}</style>
    </div>
  );
}

function Stats({ data }: { data: Profile }) {
  const s = data.stats;
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {s !== undefined && (s.seatGames[0] + s.seatGames[1] > 0) && (
        <Card>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 14 }}>
            <span>First seat <strong className="font-mono">{s.seatWins[0]}/{s.seatGames[0]}</strong></span>
            <span>Second seat <strong className="font-mono">{s.seatWins[1]}/{s.seatGames[1]}</strong></span>
            {s.streak > 1 && <Badge tone={s.streakWon ? 'good' : 'bad'}>{s.streak} {s.streakWon ? 'wins' : 'losses'} in a row</Badge>}
            {s.winRate !== undefined && <span>Win rate <strong className="font-mono">{s.winRate}%</strong></span>}
            {s.avgDurationSec !== undefined && s.avgDurationSec > 0 && (
              <span>Avg game <strong className="font-mono">{Math.floor(s.avgDurationSec / 60)}m {s.avgDurationSec % 60}s</strong></span>
            )}
            {(s.timeouts ?? 0) + (s.resignations ?? 0) > 0 && (
              <span style={{ color: 'var(--muted)' }}>{s.timeouts ?? 0} timeouts · {s.resignations ?? 0} resignations</span>
            )}
          </div>
        </Card>
      )}
      {data.puzzles !== undefined && (data.puzzles.solves > 0 || data.puzzles.streak > 0) && (
        <Card>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', fontSize: 14 }}>
            <strong>Puzzles</strong>
            <span><strong className="font-mono">{data.puzzles.solves}</strong> solved</span>
            {data.puzzles.streak > 0 && <Badge tone="good"><span style={{ display: 'inline-flex', gap: 5, alignItems: 'center' }}><Icon name="flame" size={14} /> {data.puzzles.streak}-day streak</span></Badge>}
            <Link to="/puzzles" style={{ marginLeft: 'auto', fontSize: 13 }}>Train →</Link>
          </div>
        </Card>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 12 }}>
        {data.ratings.map((r) => (
          <Card key={r.mode}>
            <div style={{ textTransform: 'capitalize', color: 'var(--muted)', fontSize: 13, fontWeight: 700 }}>{r.mode}</div>
            <div className="font-mono" style={{ fontSize: 26, fontWeight: 800 }}>{r.rating}</div>
            <div style={{ margin: '6px 0' }}><DivisionBadge rating={r.rating} /></div>
            <div style={{ fontSize: 13, color: 'var(--muted)' }}>peak {r.peak} · {r.games} · {r.wins}W/{r.losses}L</div>
          </Card>
        ))}
      </div>
    </div>
  );
}

function Archive({ data, limit }: { data: Profile; limit?: number }) {
  const games = limit !== undefined ? data.recentGames.slice(0, limit) : data.recentGames;
  return (
    <Card>
      <h2 style={{ margin: '0 0 10px' }}>Games {limit === undefined ? `(${data.recentGames.length})` : ''}</h2>
      {games.length === 0
        ? <p style={{ color: 'var(--muted)', margin: 0 }}>No games yet.</p>
        : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
            {games.map((g) => (
              <li key={g.id} style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 14, borderTop: '1px solid var(--line)', paddingTop: 8 }}>
                {g.won !== null && (
                  <span className="font-mono" style={{
                    fontWeight: 800, width: 22, height: 22, borderRadius: 6, display: 'inline-flex',
                    alignItems: 'center', justifyContent: 'center', fontSize: 13,
                    background: g.won ? 'var(--good)' : 'var(--surface-2)', color: g.won ? '#fff' : 'var(--muted)',
                  }}>
                    {g.won ? '1' : '0'}
                  </span>
                )}
                <Link
                  to={g.status === 'FINISHED' ? `/replay/${encodeURIComponent(g.id)}` : `/game/${encodeURIComponent(g.id)}`}
                  style={{ fontWeight: 700 }}
                >
                  {g.timeControl} · {g.mode}
                </Link>
                <Badge tone={g.status === 'FINISHED' ? 'neutral' : 'info'}>{g.status.toLowerCase()}</Badge>
                {g.result !== null && g.result.winnerSeat !== null && (
                  <span style={{ color: 'var(--muted)' }}>seat {g.result.winnerSeat + 1} won ({g.result.reason})</span>
                )}
              </li>
            ))}
          </ul>
        )}
    </Card>
  );
}

function FriendsPreview() {
  const [friends, setFriends] = useState<{ username: string; online: boolean }[] | null>(null);
  useEffect(() => {
    let live = true;
    api.friends().then((r) => { if (live) setFriends(r.friends); }).catch(() => { if (live) setFriends([]); });
    return () => { live = false; };
  }, []);
  if (friends === null || friends.length === 0) return null;
  return (
    <Card>
      <div style={{ fontWeight: 800, marginBottom: 8 }}>Friends {friends.length}</div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {friends.slice(0, 6).map((f) => (
          <Link key={f.username} to={`/profile/${encodeURIComponent(f.username)}`} title={`${f.username}${f.online ? ' (online)' : ''}`}>
            <Avatar name={f.username} size={40} />
          </Link>
        ))}
      </div>
    </Card>
  );
}

function FriendsTab({ self }: { self: boolean }) {
  const [friends, setFriends] = useState<{ username: string; online: boolean }[] | null>(null);
  useEffect(() => {
    if (!self) return;
    let live = true;
    api.friends().then((r) => { if (live) setFriends(r.friends); }).catch(() => { if (live) setFriends([]); });
    return () => { live = false; };
  }, [self]);
  if (!self) return <Card><p style={{ color: 'var(--muted)', margin: 0 }}>Friends are private.</p></Card>;
  if (friends === null) return <Spinner />;
  if (friends.length === 0) {
    return <Card><EmptyState title="No friends yet" body="Add friends to play together." action={<Link to="/friends">Find friends</Link>} /></Card>;
  }
  return (
    <Card>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(150px,1fr))', gap: 10 }}>
        {friends.map((f) => (
          <Link key={f.username} to={`/profile/${encodeURIComponent(f.username)}`} style={{ display: 'flex', gap: 10, alignItems: 'center', textDecoration: 'none' }}>
            <Avatar name={f.username} size={40} />
            <span>
              <span style={{ display: 'block', fontWeight: 700, fontSize: 14 }}>{f.username}</span>
              <span style={{ fontSize: 12, color: f.online ? 'var(--good)' : 'var(--muted)' }}>{f.online ? 'online' : 'offline'}</span>
            </span>
          </Link>
        ))}
      </div>
    </Card>
  );
}

function LevelChip({ username }: { username: string }) {
  const [xp, setXp] = useState<{ level: number; xp: number } | null>(null);
  useEffect(() => {
    let live = true;
    api.xp(username).then((r) => { if (live) setXp({ level: r.level, xp: r.xp }); }).catch(() => undefined);
    return () => { live = false; };
  }, [username]);
  if (xp === null) return null;
  return <Badge tone="info">Lv {xp.level}</Badge>;
}

function ReportUserButton({ username }: { username: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [done, setDone] = useState(false);
  if (!open) {
    return <Button size="sm" variant="subtle" onClick={() => setOpen(true)}>Report</Button>;
  }
  if (done) return <span style={{ color: 'var(--muted)', fontSize: 13 }}>Reported.</span>;
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
