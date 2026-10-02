/**
 * Puzzles: daily curated wall puzzle, party puzzle, and personal mistake
 * trainer. Chess-style layout: board left, detail rail right.
 * Guests can study every position; submitting requires an account.
 */
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import GameBoard from '../../components/game/GameBoard.js';
import MultiBoard from '../../components/game/MultiBoard.js';
import { Badge, Card, ErrorBox, Spinner } from '../../components/ui/primitives.js';
import { api } from '../../lib/api.js';
import { useSession } from '../../stores/session.js';
import type { GameState } from '../../../../engine/typescript/core/types.js';
import type { MultiState, SeatSide } from '../../../../engine/typescript/index.js';

type Difficulty = 'classic' | 'tricky' | 'sharp' | 'devilish';

const DIFFICULTY_TONE: Record<Difficulty, 'info' | 'warn' | 'bad' | 'good'> = {
  classic: 'info',
  tricky: 'warn',
  sharp: 'bad',
  devilish: 'bad',
};

const DIFFICULTY_BLURB: Record<Difficulty, string> = {
  classic: 'Classic — several walls may reach the target.',
  tricky: 'Tricky — look past the obvious wall.',
  sharp: 'Sharp — a single wall stands clearly above the rest.',
  devilish: 'Devilish — the answer gains big and nothing else comes close.',
};

function DifficultyBadge({ value }: { value: Difficulty | undefined }) {
  const d: Difficulty = value ?? 'classic';
  return <Badge tone={DIFFICULTY_TONE[d]}>{d}</Badge>;
}

export default function PuzzlesPage() {
  const { user } = useSession();
  return (
    <div style={{ display: 'grid', gap: 24 }}>
      <DailyPuzzle userLoggedIn={user !== null} />
      <PartyPuzzle userLoggedIn={user !== null} />
      {user !== null && <MyMistakes />}
    </div>
  );
}

function DailyPuzzle({ userLoggedIn }: { userLoggedIn: boolean }) {
  const navigate = useNavigate();
  const [data, setData] = useState<Awaited<ReturnType<typeof api.puzzleDaily>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [verdict, setVerdict] = useState<Awaited<ReturnType<typeof api.puzzleAttempt>> | null>(null);
  const [attempts, setAttempts] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.puzzleDaily()
      .then((d) => { if (!cancelled) setData(d); })
      .catch((err: unknown) => { if (!cancelled) setError(err instanceof Error ? err.message : 'Puzzle unavailable'); });
    return () => { cancelled = true; };
  }, []);

  async function submit(wall: { r: number; c: number; orientation: 'h' | 'v' }) {
    if (!userLoggedIn) {
      navigate('/login?next=/puzzles');
      return;
    }
    setBusy(true);
    try {
      const res = await api.puzzleAttempt(wall);
      setVerdict(res);
      setAttempts((n) => n + 1);
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
  const solved = verdict?.solved === true || data.solvedToday;
  const target = verdict?.solutionGain ?? null;

  return (
    <section style={{ display: 'grid', gap: 12 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0 }}>Daily puzzle</h1>
        <Badge tone="info">{data.date}</Badge>
        <DifficultyBadge value={data.difficulty} />
        {data.tasteSource === 'ai' && <Badge tone="good">AI curated</Badge>}
        {data.streak > 0 && <Badge tone="good">🔥 {data.streak}-day streak</Badge>}
        {data.solvedToday && <Badge tone="good">solved today</Badge>}
      </div>
      <p style={{ color: 'var(--muted)', margin: 0 }}>{DIFFICULTY_BLURB[data.difficulty ?? 'classic']}</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 300px', gap: 16, alignItems: 'start' }} className="nexus-game-layout">
        <div style={{ maxWidth: 560 }}>
          <GameBoard
            state={state}
            humanSeats={[data.turn]}
            interactive={!busy && !solved}
            onMove={() => undefined}
            onWall={submit}
          />
        </div>
        <div style={{ display: 'grid', gap: 12 }}>
          <Card>
            <h3 style={{ margin: '0 0 8px' }}>Your move</h3>
            <p style={{ color: 'var(--muted)', margin: '0 0 8px', fontSize: 14 }}>{data.prompt}</p>
            <p style={{ margin: '0 0 8px', fontSize: 14 }}>
              Target: lengthen the route by <strong>+{data.needGain}</strong>
              {target !== null && target > data.needGain && <> · best answer <strong>+{target}</strong></>}
              {(data.alternatives ?? 1) <= 1 && <> · <strong>unique answer</strong></>}
            </p>
            {!userLoggedIn && <p style={{ color: 'var(--muted)', fontSize: 14 }}><Link to="/login?next=/puzzles">Log in</Link> to submit and keep a streak.</p>}
            {verdict === null
              ? <p style={{ color: 'var(--muted)', margin: 0, fontSize: 14 }}>{attempts === 0 ? 'Click a groove to submit your wall.' : `${attempts} attempt${attempts === 1 ? '' : 's'} so far.`}</p>
              : verdict.solved
                ? (
                  <div>
                    <Badge tone="good">Solved! +{verdict.gain} route</Badge>
                    <p style={{ color: 'var(--muted)', fontSize: 14 }}>
                      {verdict.solution !== undefined && <>Reference: {verdict.solution.orientation === 'h' ? '—' : '|'} at row {verdict.solution.r}, col {verdict.solution.c}. </>}
                      Streak: {verdict.streak} day(s).
                    </p>
                  </div>
                )
                : (
                  <div>
                    <Badge tone={verdict.legal ? 'warn' : 'bad'}>
                      {verdict.legal ? `Not enough (+${verdict.gain}, need +${verdict.need})` : (verdict.reason ?? 'Illegal wall')}
                    </Badge>
                    <p style={{ color: 'var(--muted)', fontSize: 14, marginBottom: 0 }}>Attempt {attempts} recorded — study the corridor and try again.</p>
                  </div>
                )}
          </Card>
          <Card>
            <h3 style={{ margin: '0 0 8px' }}>How it works</h3>
            <p style={{ color: 'var(--muted)', fontSize: 13, margin: 0 }}>
              One position for everyone, refreshed daily. An AI curator picks the most demanding
              engine-graded candidate each morning — alternate winning walls are accepted.
            </p>
          </Card>
        </div>
      </div>
      <style>{`@media (max-width: 900px) { .nexus-game-layout { grid-template-columns: minmax(0,1fr) !important; } }`}</style>
    </section>
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
    continueAfterWin: false,
    eliminated: [],
    placement: [],
    teamOf: null,
    winningTeam: null,
    fog: false,
    chaos: false,
    siege: false,
    siegeHeadStart: 0,
  };

  return (
    <section style={{ display: 'grid', gap: 12 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0 }}>Party puzzle</h2>
        <Badge tone="info">{data.date} · {data.players} players</Badge>
        <DifficultyBadge value={data.difficulty} />
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
          <h3 style={{ margin: '0 0 8px' }}>Your move</h3>
          <p style={{ color: 'var(--muted)', fontSize: 14, margin: '0 0 8px' }}>
            Target: lengthen the leader's route by <strong>+{data.needGain}</strong>.
          </p>
          {verdict === null
            ? <p style={{ color: 'var(--muted)', margin: 0, fontSize: 14 }}>Choke the leader — every attempt counts toward XP.</p>
            : verdict.solved
              ? <p style={{ margin: 0 }}><Badge tone="good">Solved! +{verdict.gain} on the leader</Badge></p>
              : <p style={{ margin: 0 }}><Badge tone={verdict.legal ? 'warn' : 'bad'}>{verdict.legal ? `Only +${verdict.gain}, need +${verdict.need}` : 'Illegal wall'}</Badge></p>}
        </Card>
      </div>
    </section>
  );
}

type MineItem = Awaited<ReturnType<typeof api.trainingMine>>['puzzles'][number];

function MyMistakes() {
  const [items, setItems] = useState<MineItem[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.trainingMine()
      .then((d) => { if (!cancelled) setItems(d.puzzles); })
      .catch(() => { if (!cancelled) setItems([]); });
    return () => { cancelled = true; };
  }, []);

  if (items === null) return <Spinner />;
  if (items.length === 0) return null;

  return (
    <section style={{ display: 'grid', gap: 12 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0 }}>Fix your mistakes</h2>
        <Badge tone="warn">{items.length} position{items.length === 1 ? '' : 's'} from your games</Badge>
      </div>
      <p style={{ color: 'var(--muted)', margin: 0 }}>
        Real blunders from your finished games, found by the engine. Find the stronger continuation — moves and walls both accepted.
      </p>
      <div style={{ display: 'grid', gap: 16 }}>
        {items.map((p) => <MistakeCard key={p.puzzleId} item={p} />)}
      </div>
    </section>
  );
}

function MistakeCard({ item }: { item: MineItem }) {
  const [verdict, setVerdict] = useState<Awaited<ReturnType<typeof api.trainingAttempt>> | null>(null);
  const [busy, setBusy] = useState(false);

  async function attempt(action: { type: 'move'; to: { r: number; c: number } } | { type: 'wall'; wall: { r: number; c: number; orientation: 'h' | 'v' } }) {
    if (busy || verdict?.solved === true || item.solved) return;
    setBusy(true);
    try {
      setVerdict(await api.trainingAttempt(item.gameId, item.seq, action));
    } catch {
      setVerdict(null);
    } finally {
      setBusy(false);
    }
  }

  const state: GameState = {
    size: item.position.size,
    wallsPerPlayer: item.position.wallsPerPlayer,
    turn: item.position.turn,
    pawns: [{ ...item.position.pawns[0] }, { ...item.position.pawns[1] }],
    walls: item.position.walls.map((w) => ({ ...w })),
    wallsRemaining: [...item.position.wallsRemaining],
    winner: null,
    isOver: false,
    moveNumber: 0,
    lastAction: null,
    rulesVersion: '1.0.0',
  };
  const solved = verdict?.solved === true || item.solved;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 300px', gap: 16, alignItems: 'start' }} className="nexus-game-layout">
      <div style={{ maxWidth: 480 }}>
        <GameBoard
          state={state}
          humanSeats={[item.position.turn]}
          interactive={!busy && !solved}
          onMove={(to) => void attempt({ type: 'move', to })}
          onWall={(wall) => void attempt({ type: 'wall', wall })}
        />
      </div>
      <Card>
        <h3 style={{ margin: '0 0 8px' }}>Your blunder</h3>
        <p style={{ color: 'var(--muted)', fontSize: 14, margin: '0 0 8px' }}>
          {item.labels.join(' · ')} — you played <strong>{item.played}</strong>.
        </p>
        {verdict === null
          ? <p style={{ color: 'var(--muted)', margin: 0, fontSize: 14 }}>{solved ? 'Already fixed — nice.' : 'Play the stronger continuation.'}</p>
          : verdict.solved
            ? <p style={{ margin: 0 }}><Badge tone="good">Fixed! Best was {verdict.best}</Badge></p>
            : <p style={{ margin: 0 }}><Badge tone="warn">Not it — you played {verdict.played}</Badge></p>}
        {!solved && <p style={{ color: 'var(--muted)', fontSize: 13 }}>Tip: the engine's best line starts with <strong>{item.best.split(' ')[0]}</strong>.</p>}
      </Card>
    </div>
  );
}
