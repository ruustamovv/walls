/**
 * Home: greeting, quick play, menu cards, daily puzzle, recent game,
 * streak, live counters, archive preview. Every number is real.
 */
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import GameBoard from '../../components/game/GameBoard.js';
import { Avatar, Badge, Button, Card, Modal, Spinner } from '../../components/ui/primitives.js';
import { Icon, type IconName } from '../../components/ui/icons.js';
import { api } from '../../lib/api.js';
import { useSession } from '../../stores/session.js';
import { useQuickMatch } from '../../hooks/useQuickMatch.js';
import type { GameState } from '../../../../engine/typescript/core/types.js';

const QUICK_TCS = ['1+0', '3+1', '10+0'] as const;

export default function HomePage() {
  const { user } = useSession();
  const navigate = useNavigate();
  const qm = useQuickMatch();
  const [tc, setTc] = useState<string>('3+1');
  const [profile, setProfile] = useState<Awaited<ReturnType<typeof api.profile>> | null>(null);
  const [daily, setDaily] = useState<Awaited<ReturnType<typeof api.puzzleDaily>> | null>(null);
  const [stats, setStats] = useState<Awaited<ReturnType<typeof api.publicStats>> | null>(null);
  const [liveCount, setLiveCount] = useState<number | null>(null);
  const [rival, setRival] = useState<{ username: string; rating: number } | null>(null);
  const [lesson, setLesson] = useState<{ done: number; total: number } | null>(null);
  const [challenged, setChallenged] = useState(false);

  useEffect(() => {
    let live = true;
    api.publicStats().then((s) => { if (live) setStats(s); }).catch(() => undefined);
    api.liveGames().then((r) => { if (live) setLiveCount(r.games.length); }).catch(() => undefined);
    api.puzzleDaily().then((d) => { if (live) setDaily(d); }).catch(() => undefined);
    api.leaderboard('blitz').then((l) => {
      if (!live) return;
      const first = l.entries.find((e) => e.username !== user?.username);
      if (first !== undefined) setRival({ username: first.username, rating: first.rating });
    }).catch(() => undefined);
    api.learnCurriculum().then((c) => {
      if (!live) return;
      const steps = c.lessons.flatMap((l) => l.steps);
      setLesson({ done: steps.filter((s) => s.solved).length, total: steps.length });
    }).catch(() => undefined);
    return () => { live = false; };
  }, []);
  useEffect(() => {
    if (user === null || user.guest === true) {
      setProfile(null);
      return;
    }
    let live = true;
    api.profile(user.username).then((p) => { if (live) setProfile(p); }).catch(() => undefined);
    return () => { live = false; };
  }, [user]);

  async function play(): Promise<void> {
    const mode = user !== null && !user.guest ? 'ranked' : 'casual';
    await qm.start(tc, mode);
  }

  const recent = profile?.recentGames ?? [];
  const lastGame = recent[0];
  const puzzleStreak = profile?.puzzles?.streak ?? 0;

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <Avatar name={user?.username ?? 'guest'} size={40} />
        <h1 className="font-display" style={{ margin: 0, fontSize: 22 }}>
          {user === null ? 'Play now' : user.guest ? 'Guest game' : user.username}
        </h1>
        {puzzleStreak > 0 && <Badge tone="good"><span style={{ display: 'inline-flex', gap: 5, alignItems: 'center' }}><Icon name="flame" size={14} /> {puzzleStreak}</span></Badge>}
        <span style={{ marginLeft: 'auto', fontSize: 13, color: 'var(--muted)' }}>
          {stats === null
            ? '…'
            : stats.users > 0
              ? `${stats.users.toLocaleString()} players · ${stats.gamesToday.toLocaleString()} games today`
              : liveCount !== null && liveCount > 0 ? `${liveCount} live now` : ''}
        </span>
      </div>

      <div className="home-grid">
        <div style={{ display: 'grid', gap: 16, alignContent: 'start' }}>
          <Card>
            <h2 className="font-display" style={{ margin: '0 0 10px', fontSize: 17 }}>Play online</h2>
            <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
              {QUICK_TCS.map((t) => (
                <button
                  key={t}
                  onClick={() => setTc(t)}
                  style={{
                    flex: 1, borderRadius: 10, padding: '8px 0', fontWeight: 800, fontSize: 14,
                    border: tc === t ? '2px solid var(--good)' : '1px solid var(--line)',
                    background: tc === t ? 'var(--good-soft)' : 'var(--surface-2)', color: 'var(--ink)', cursor: 'pointer',
                  }}
                >
                  {t.replace('+0', ' min').replace('+', ' + ')}
                </button>
              ))}
            </div>
            <Button size="lg" onClick={() => void play()} disabled={qm.searching} style={{ width: '100%', background: 'var(--good)', borderColor: 'var(--good)' }}>
              {qm.searching ? 'Searching…' : 'Play'}
            </Button>
            {qm.error !== null && <p role="alert" style={{ color: 'var(--bad)', fontSize: 13 }}>{qm.error}</p>}
            {qm.searching && <Button variant="ghost" onClick={() => void qm.cancel()} style={{ width: '100%', marginTop: 8 }}>Cancel</Button>}
          </Card>

          <div className="home-menu">
            <MenuCard to="/play?cat=online" icon="bolt" title="Online" sub="Same level opponents" />
            <MenuCard to="/play?cat=bots" icon="bot" title="Bots" sub="Beginner to master" />
            <MenuCard to="/learn" icon="coach" title="Coach" sub="Learn by playing" />
            <MenuCard to="/play?cat=friend" icon="friend" title="Friend" sub="Invite with a link" />
          </div>

          {recent.length > 0 && (
            <Card>
              <h2 className="font-display" style={{ margin: '0 0 8px', fontSize: 17 }}>Recent games</h2>
              <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
                {recent.slice(0, 5).map((g) => (
                  <li key={g.id} style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 14 }}>
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
                    {g.status === 'FINISHED' && (
                      <button
                        onClick={() => navigate(`/game/${encodeURIComponent(g.id)}`)}
                        style={{ background: 'none', border: 'none', padding: 0, color: 'var(--primary)', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}
                      >
                        Review
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>

        <div style={{ display: 'grid', gap: 16, alignContent: 'start' }}>
          <Card>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 8 }}>
              <h2 className="font-display" style={{ margin: 0, fontSize: 17 }}>Daily puzzle</h2>
              {daily !== null && <Badge tone="info">{daily.difficulty ?? 'classic'}</Badge>}
            </div>
            {daily === null ? <Spinner /> : <DailyMini data={daily} />}
            <Link to="/puzzles"><Button style={{ width: '100%', marginTop: 10 }}>Solve</Button></Link>
          </Card>
          {lastGame !== undefined && (
            <Card>
              <h2 className="font-display" style={{ margin: '0 0 8px', fontSize: 17 }}>Last game</h2>
              <p style={{ margin: '0 0 10px', fontSize: 14 }}>
                {lastGame.timeControl} · {lastGame.mode} · {lastGame.status.toLowerCase()}
              </p>
              <Link to={lastGame.status === 'FINISHED' ? `/replay/${encodeURIComponent(lastGame.id)}` : `/game/${encodeURIComponent(lastGame.id)}`}>
                <Button variant="ghost" style={{ width: '100%' }}>Open</Button>
              </Link>
            </Card>
          )}
          {rival !== null && (
            <Card>
              <h2 className="font-display" style={{ margin: '0 0 8px', fontSize: 17 }}>Top player</h2>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 10 }}>
                <Avatar name={rival.username} size={34} />
                <div>
                  <div style={{ fontWeight: 800 }}>{rival.username}</div>
                  <div className="font-mono" style={{ fontSize: 13, color: 'var(--muted)' }}>blitz {rival.rating}</div>
                </div>
              </div>
              {user !== null && !user.guest ? (
                challenged ? (
                  <Badge tone="good">Challenge sent</Badge>
                ) : (
                  <Button
                    variant="ghost"
                    style={{ width: '100%' }}
                    onClick={() => {
                      void api.challenge(rival.username, '3+1', 'ranked')
                        .then(() => setChallenged(true))
                        .catch(() => setChallenged(false));
                    }}
                  >
                    Challenge
                  </Button>
                )
              ) : (
                <Link to="/signup?next=/"><Button variant="ghost" style={{ width: '100%' }}>Join to challenge</Button></Link>
              )}
            </Card>
          )}
          {lesson !== null && lesson.total > 0 && (
            <Card>
              <h2 className="font-display" style={{ margin: '0 0 8px', fontSize: 17 }}>Lessons</h2>
              <div style={{ height: 6, borderRadius: 999, background: 'var(--surface-2)', overflow: 'hidden', marginBottom: 8 }}>
                <div style={{ width: `${Math.round((lesson.done / lesson.total) * 100)}%`, height: '100%', background: 'var(--good)' }} />
              </div>
              <p style={{ color: 'var(--muted)', fontSize: 13, margin: '0 0 10px' }}>{lesson.done}/{lesson.total} steps</p>
              <Link to="/learn"><Button variant="ghost" style={{ width: '100%' }}>{lesson.done === 0 ? 'Start' : 'Continue'}</Button></Link>
            </Card>
          )}
        </div>
      </div>

      {qm.searching && (
        <Modal title="Finding opponent…" onClose={() => void qm.cancel()}>
          <p style={{ color: 'var(--muted)' }}>{qm.desc} · widening… <span className="nexus-pulse">●</span></p>
          <Button variant="ghost" onClick={() => void qm.cancel()}>Cancel</Button>
        </Modal>
      )}
      <style>{`@media (min-width: 900px) { .home-grid { display: grid; grid-template-columns: minmax(0,1.2fr) minmax(0,1fr); gap: 16px; align-items: start; } .home-menu { display: grid; gap: 8px; } } @media (max-width: 899px) { .home-grid { display: grid; gap: 16px; } .home-menu { display: grid; gap: 8px; } }`}</style>
    </div>
  );
}

function MenuCard({ to, icon, title, sub }: { to: string; icon: IconName; title: string; sub: string }) {
  return (
    <Link to={to} style={{
      display: 'flex', gap: 12, alignItems: 'center', textDecoration: 'none',
      background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--radius-md)', padding: '12px 14px',
    }}>
      <span style={{ color: 'var(--primary)' }}><Icon name={icon} size={26} /></span>
      <span>
        <span style={{ display: 'block', fontWeight: 800 }}>{title}</span>
        <span style={{ display: 'block', fontSize: 12, color: 'var(--muted)' }}>{sub}</span>
      </span>
    </Link>
  );
}

function DailyMini({ data }: { data: Awaited<ReturnType<typeof api.puzzleDaily>> }) {
  const state: GameState = {
    size: data.size,
    wallsPerPlayer: 10,
    turn: data.turn,
    pawns: [{ ...data.pawns[0] }, { ...data.pawns[1] }],
    walls: data.walls.map((w) => ({ ...w })),
    wallsRemaining: [...data.wallsRemaining],
    winner: null,
    isOver: false,
    moveNumber: 0,
    lastAction: null,
    rulesVersion: '1.0.0',
  };
  return (
    <div style={{ maxWidth: 300 }}>
      <GameBoard state={state} humanSeats={[]} interactive={false} onMove={() => undefined} onWall={() => undefined} />
      <p style={{ color: 'var(--muted)', fontSize: 13, margin: '8px 0 0' }}>
        +{data.needGain} target · one for everyone today
      </p>
    </div>
  );
}
