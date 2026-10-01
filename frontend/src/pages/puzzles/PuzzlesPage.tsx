/**
 * Daily wall puzzle: one position for everyone, streaks for members.
 * Guests can study the position; submitting requires an account.
 */
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import GameBoard from '../../components/game/GameBoard.js';
import MultiBoard from '../../components/game/MultiBoard.js';
import { Badge, Button, Card, ErrorBox, Spinner } from '../../components/ui/primitives.js';
import { api } from '../../lib/api.js';
import { useSession } from '../../stores/session.js';
import type { GameState } from '../../../../engine/typescript/core/types.js';
import type { MultiState, SeatSide } from '../../../../engine/typescript/index.js';

export default function PuzzlesPage() {
  const { user } = useSession();
  const navigate = useNavigate();
  const [data, setData] = useState<Awaited<ReturnType<typeof api.puzzleDaily>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [verdict, setVerdict] = useState<Awaited<ReturnType<typeof api.puzzleAttempt>> | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.puzzleDaily()
      .then((d) => { if (!cancelled) setData(d); })
      .catch((err: unknown) => { if (!cancelled) setError(err instanceof Error ? err.message : 'Puzzle unavailable'); });
    return () => { cancelled = true; };
  }, []);

  async function submit(wall: { r: number; c: number; orientation: 'h' | 'v' }) {
    if (user === null) {
      navigate('/login?next=/puzzles');
      return;
    }
    setBusy(true);
    try {
      const res = await api.puzzleAttempt(wall);
      setVerdict(res);
    } catch (err) {
      setVerdict(null);
      setError(err instanceof Error ? err.message : 'Attempt failed');
    } finally {
      setBusy(false);
    }
  }

  if (error !== null && data === null) return <ErrorBox message={error} />;
  if (data === null) return <Spinner />;

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
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0 }}>Daily puzzle</h1>
        <Badge tone="info">{data.date}</Badge>
        {data.streak > 0 && <Badge tone="good">🔥 {data.streak}-day streak</Badge>}
        {data.solvedToday && <Badge tone="good">solved today</Badge>}
      </div>
      <p style={{ color: 'var(--muted)', margin: 0 }}>{data.prompt} Click a groove to submit your wall.</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 300px', gap: 16, alignItems: 'start' }} className="nexus-game-layout">
        <div style={{ maxWidth: 560 }}>
          <GameBoard
            state={state}
            humanSeats={[data.turn]}
            interactive={!busy && !verdict?.solved}
            onMove={() => undefined}
            onWall={submit}
          />
        </div>
        <Card>
          <h3 style={{ margin: '0 0 8px' }}>Your attempt</h3>
          {user === null && <p style={{ color: 'var(--muted)' }}><Link to="/login?next=/puzzles">Log in</Link> to submit and keep a streak.</p>}
          {verdict === null
            ? <p style={{ color: 'var(--muted)', margin: 0 }}>No attempt yet — find the choke point.</p>
            : verdict.solved
              ? (
                <div>
                  <Badge tone="good">Solved! +{verdict.gain} route</Badge>
                  <p style={{ color: 'var(--muted)', fontSize: 14 }}>
                    Reference wall gains the same bar. Streak: {verdict.streak} day(s).
                  </p>
                </div>
              )
              : (
                <div>
                  <Badge tone={verdict.legal ? 'warn' : 'bad'}>
                    {verdict.legal ? `Not enough (+${verdict.gain}, need +${verdict.need})` : (verdict.reason ?? 'Illegal wall')}
                  </Badge>
                  <p style={{ color: 'var(--muted)', fontSize: 14 }}>Try again — every attempt is recorded.</p>
                </div>
              )}
        </Card>
      </div>
      <style>{`@media (max-width: 900px) { .nexus-game-layout { grid-template-columns: minmax(0,1fr) !important; } }`}</style>
      <PartyPuzzle userLoggedIn={user !== null} />
    </div>
  );
}

function PartyPuzzle({ userLoggedIn }: { userLoggedIn: boolean }) {
  const navigate = useNavigate();
  const [data, setData] = useState<Awaited<ReturnType<typeof api.multiPuzzleDaily>> | null>(null);
  const [verdict, setVerdict] = useState<Awaited<ReturnType<typeof api.multiPuzzleAttempt>> | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.multiPuzzleDaily()
      .then((d) => { if (!cancelled) setData(d); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  async function submit(wall: { r: number; c: number; orientation: 'h' | 'v' }) {
    if (!userLoggedIn) {
      navigate('/login?next=/puzzles');
      return;
    }
    setBusy(true);
    try {
      setVerdict(await api.multiPuzzleAttempt(wall));
    } catch {
      setVerdict(null);
    } finally {
      setBusy(false);
    }
  }

  if (data === null) return null;
  const state: MultiState = {
    size: data.size,
    wallsPerPlayer: 5,
    players: data.players,
    sides: (['S', 'N', 'E', 'W'].slice(0, data.players) as SeatSide[]),
    turn: data.turn,
    pawns: data.pawns.map((p) => ({ ...p })),
    walls: data.walls.map((w) => ({ ...w })),
    wallsRemaining: [...data.wallsRemaining],
    winner: null,
    isOver: false,
    moveNumber: 0,
    lastAction: null,
    rulesVersion: '1.0.0-m1',
  };

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0 }}>Party puzzle</h2>
        <Badge tone="info">{data.date} · {data.players} players</Badge>
        {verdict?.solved === true && <Badge tone="good">solved +{verdict.gain}</Badge>}
      </div>
      <p style={{ color: 'var(--muted)', margin: 0 }}>{data.prompt}</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 300px', gap: 16, alignItems: 'start' }} className="nexus-game-layout">
        <div style={{ maxWidth: 560 }}>
          <MultiBoard
            state={state}
            humanSeats={[data.turn]}
            interactive={!busy && verdict?.solved !== true}
            onMove={() => undefined}
            onWall={submit}
          />
        </div>
        <Card>
          <h3 style={{ margin: '0 0 8px' }}>Your attempt</h3>
          {verdict === null
            ? <p style={{ color: 'var(--muted)', margin: 0 }}>Choke the leader — every attempt counts toward XP.</p>
            : verdict.solved
              ? <p style={{ margin: 0 }}><Badge tone="good">Solved! +{verdict.gain} on the leader</Badge></p>
              : <p style={{ margin: 0 }}><Badge tone={verdict.legal ? 'warn' : 'bad'}>{verdict.legal ? `Only +${verdict.gain}, need +${verdict.need}` : 'Illegal wall'}</Badge></p>}
        </Card>
      </div>
    </div>
  );
}
