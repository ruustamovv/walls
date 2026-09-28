/**
 * Puzzle Rush & Survival: chained wall tactics against the clock.
 * Rush: 3:00 on the clock, +5s per solve, 3 strikes. Survival: no clock,
 * one life. Puzzles are server-generated and server-graded per seed.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import GameBoard from '../../components/game/GameBoard.js';
import { Badge, Button, Card, EmptyState, Spinner, Tabs } from '../../components/ui/primitives.js';
import { api } from '../../lib/api.js';
import { useSession } from '../../stores/session.js';
import { playSound } from '../../lib/sound.js';
import type { GameState } from '../../../../engine/typescript/core/types.js';

type Mode = 'rush' | 'survival';
type Phase = 'idle' | 'running' | 'over';

interface RushPuzzle {
  seed: string;
  size: number;
  turn: 0 | 1;
  pawns: [{ r: number; c: number }, { r: number; c: number }];
  walls: { r: number; c: number; orientation: 'h' | 'v' }[];
  wallsRemaining: [number, number];
  needGain: number;
}

const RUSH_SECONDS = 180;
const RUSH_BONUS = 5;
const RUSH_LIVES = 3;

export default function RushPage() {
  const { user } = useSession();
  const [mode, setMode] = useState<Mode>('rush');
  const [phase, setPhase] = useState<Phase>('idle');
  const [puzzle, setPuzzle] = useState<RushPuzzle | null>(null);
  const [index, setIndex] = useState(0);
  const [score, setScore] = useState(0);
  const [strikes, setStrikes] = useState(0);
  const [timeLeft, setTimeLeft] = useState(RUSH_SECONDS);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const [stats, setStats] = useState<Awaited<ReturnType<typeof api.rushStats>> | null>(null);
  const endAt = useRef(0);

  const loadStats = useCallback(() => {
    api.rushStats().then(setStats).catch(() => undefined);
  }, []);
  useEffect(() => { loadStats(); }, [loadStats]);

  const fetchPuzzle = useCallback(async (i: number) => {
    const p = await api.rushNext(i);
    setPuzzle({
      seed: p.seed, size: p.size, turn: p.turn, pawns: p.pawns,
      walls: p.walls, wallsRemaining: p.wallsRemaining, needGain: p.needGain,
    });
    setIndex(i);
    setFlash(null);
  }, []);

  const start = useCallback(async () => {
    setScore(0);
    setStrikes(0);
    setTimeLeft(RUSH_SECONDS);
    setPhase('running');
    endAt.current = Date.now() + RUSH_SECONDS * 1000;
    try {
      await fetchPuzzle(0);
    } catch {
      setPhase('idle');
    }
  }, [fetchPuzzle]);

  // Rush countdown.
  useEffect(() => {
    if (phase !== 'running' || mode !== 'rush') return;
    const id = setInterval(() => {
      const left = Math.max(0, Math.round((endAt.current - Date.now()) / 1000));
      setTimeLeft(left);
      if (left <= 0) {
        setPhase('over');
        playSound('lose');
        loadStats();
      }
    }, 250);
    return () => clearInterval(id);
  }, [phase, mode, loadStats]);

  async function submit(wall: { r: number; c: number; orientation: 'h' | 'v' }) {
    if (puzzle === null || busy || phase !== 'running') return;
    setBusy(true);
    try {
      const res = await api.rushAttempt(puzzle.seed, wall);
      if (res.solved) {
        const next = score + 1;
        setScore(next);
        playSound('win');
        if (mode === 'rush') endAt.current += RUSH_BONUS * 1000;
        await fetchPuzzle(index + 1);
      } else {
        playSound('illegal');
        const s = strikes + 1;
        setStrikes(s);
        const lives = mode === 'rush' ? RUSH_LIVES : 1;
        if (s >= lives) {
          setPhase('over');
          playSound('lose');
          loadStats();
        } else {
          setFlash(res.legal ? `Not enough (+${res.gain}, need +${res.need}) — next!` : 'Illegal wall — next!');
          await fetchPuzzle(index + 1);
        }
      }
    } catch {
      setFlash('Attempt failed — try again.');
    } finally {
      setBusy(false);
    }
  }

  if (user === null) {
    return <EmptyState title="Rush needs an account" body="Solves are recorded to your name." action={<Link to="/login?next=/rush">Log in</Link>} />;
  }

  const lives = mode === 'rush' ? RUSH_LIVES : 1;
  const state: GameState | null = puzzle === null ? null : {
    size: puzzle.size,
    wallsPerPlayer: 10,
    turn: puzzle.turn,
    pawns: [{ ...puzzle.pawns[0] }, { ...puzzle.pawns[1] }],
    walls: puzzle.walls.map((w) => ({ ...w })),
    wallsRemaining: [...puzzle.wallsRemaining],
    winner: null,
    isOver: false,
    moveNumber: 0,
    lastAction: null,
    rulesVersion: '1.0.0',
  };

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <h1 className="font-display" style={{ margin: 0 }}>Puzzle Rush</h1>
        <Tabs tabs={(['rush', 'survival'] as Mode[])} active={mode} onChange={(m) => { setMode(m); setPhase('idle'); }} />
        {stats !== null && <Badge tone="info">{stats.today} solved today · {stats.mine} all-time</Badge>}
      </div>

      {phase === 'idle' && (
        <Card>
          <p style={{ margin: '0 0 12px' }}>
            {mode === 'rush'
              ? `3:00 on the clock, +${RUSH_BONUS}s per solve, ${RUSH_LIVES} strikes. How deep can you go?`
              : 'No clock, one life. Pure accuracy — how many in a row?'}
          </p>
          <Button size="lg" onClick={() => void start()}>Start {mode === 'rush' ? 'rush' : 'survival'}</Button>
        </Card>
      )}

      {phase !== 'idle' && state !== null && (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 300px', gap: 16, alignItems: 'start' }} className="nexus-game-layout">
          <div style={{ maxWidth: 560 }}>
            <GameBoard
              state={state}
              humanSeats={[state.turn]}
              interactive={!busy && phase === 'running'}
              onMove={() => undefined}
              onWall={submit}
            />
          </div>
          <Card>
            <div style={{ display: 'flex', gap: 12, alignItems: 'baseline', marginBottom: 8 }}>
              <span className="font-mono" style={{ fontSize: 32, fontWeight: 800 }}>{score}</span>
              {mode === 'rush' && (
                <span className="font-mono" style={{ fontSize: 20, fontWeight: 700, color: timeLeft <= 10 ? 'var(--bad)' : 'var(--ink)' }}>
                  {Math.floor(timeLeft / 60)}:{String(timeLeft % 60).padStart(2, '0')}
                </span>
              )}
              <span style={{ color: 'var(--bad)', letterSpacing: 2 }} aria-label={`${strikes} strikes`}>
                {'✕'.repeat(strikes)}{'·'.repeat(Math.max(0, lives - strikes))}
              </span>
            </div>
            {flash !== null && <p style={{ color: 'var(--warn)', fontSize: 14 }}>{flash}</p>}
            {phase === 'over' && (
              <div>
                <p><Badge tone={score > 0 ? 'good' : 'neutral'}>Run over — {score} solved</Badge></p>
                <div style={{ display: 'flex', gap: 8 }}>
                  <Button onClick={() => void start()}>Go again</Button>
                  <Button variant="ghost" onClick={() => setPhase('idle')}>Lobby</Button>
                </div>
              </div>
            )}
          </Card>
        </div>
      )}

      <Card>
        <h3 className="font-display" style={{ margin: '0 0 8px' }}>Top solvers (all-time)</h3>
        {stats === null ? <Spinner /> : stats.leaders.length === 0 ? (
          <p style={{ color: 'var(--muted)', margin: 0 }}>No solves recorded yet — be the first.</p>
        ) : (
          <ol style={{ margin: 0, paddingLeft: 20, display: 'grid', gap: 4 }}>
            {stats.leaders.map((l) => (
              <li key={l.username}>
                <Link to={`/profile/${encodeURIComponent(l.username)}`} style={{ fontWeight: 700 }}>{l.username}</Link>{' '}
                <span className="font-mono">{l.solves}</span>
              </li>
            ))}
          </ol>
        )}
      </Card>
      <style>{`@media (max-width: 900px) { .nexus-game-layout { grid-template-columns: minmax(0,1fr) !important; } }`}</style>
    </div>
  );
}
