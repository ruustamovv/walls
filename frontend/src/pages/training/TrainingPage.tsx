/**
 * Personal training: your own blunders, rebuilt as puzzles.
 * Positions come from your finished games; grading matches the reference
 * outcome band, so alternate winning lines count.
 */
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import GameBoard from '../../components/game/GameBoard.js';
import { Badge, Button, Card, EmptyState, ErrorBox, Spinner } from '../../components/ui/primitives.js';
import { api } from '../../lib/api.js';
import { useSession } from '../../stores/session.js';
import type { GameState, Pos, Wall } from '../../../../engine/typescript/core/types.js';

type Mine = Awaited<ReturnType<typeof api.trainingMine>>['puzzles'][number];

export default function TrainingPage() {
  const { user } = useSession();
  const [items, setItems] = useState<Mine[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [verdict, setVerdict] = useState<{ solved: boolean; best: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setError(null);
    api.trainingMine()
      .then((r) => setItems(r.puzzles))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Training unavailable'));
  }, []);
  useEffect(() => { if (user !== null) load(); }, [user, load]);

  if (user === null) {
    return <EmptyState title="Training needs an account" body="Finish rated games, then fix your own mistakes here." action={<Link to="/login?next=/training">Log in</Link>} />;
  }

  const active = items?.find((p) => p.puzzleId === activeId) ?? null;

  async function submit(action: { type: 'move'; to: Pos } | { type: 'wall'; wall: Wall }) {
    if (active === null) return;
    setBusy(true);
    try {
      const res = await api.trainingAttempt(active.gameId, active.seq, action);
      setVerdict({ solved: res.solved, best: res.best });
      if (res.solved) load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Attempt failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <h1 className="font-display" style={{ margin: 0 }}>Training</h1>
        <Badge tone="info">from your own games</Badge>
      </div>
      {error !== null && <ErrorBox message={error} onRetry={load} />}
      {items === null ? <Spinner /> : active !== null ? (
        <TrainingBoard
          puzzle={active}
          verdict={verdict}
          busy={busy}
          onBack={() => { setActiveId(null); setVerdict(null); }}
          onSubmit={submit}
        />
      ) : items.length === 0 ? (
        <Card>
          <EmptyState
            title="No mistakes on file — yet"
            body="Play finished rated games. The engine reviews them and turns your blunders into drills."
            action={<Link to="/play">Play now</Link>}
          />
        </Card>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(260px,1fr))', gap: 12 }}>
          {items.map((p) => (
            <Card key={p.puzzleId}>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
                {p.labels.map((l) => (
                  <Badge key={l} tone={l.includes('BLUNDER') ? 'bad' : 'warn'}>{l.replace(/_/g, ' ')}</Badge>
                ))}
                {p.solved && <Badge tone="good">solved</Badge>}
              </div>
              <p style={{ fontSize: 14, margin: '0 0 4px' }}>Move {p.seq + 1} · you played <strong>{p.played}</strong></p>
              <p style={{ color: 'var(--muted)', fontSize: 13, margin: '0 0 12px' }}>
                From <Link to={`/replay/${encodeURIComponent(p.gameId)}`}>a recent game</Link>
              </p>
              <Button onClick={() => { setActiveId(p.puzzleId); setVerdict(null); }}>
                {p.solved ? 'Retry drill' : 'Fix it'}
              </Button>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function TrainingBoard({ puzzle, verdict, busy, onBack, onSubmit }: {
  puzzle: Mine;
  verdict: { solved: boolean; best: string } | null;
  busy: boolean;
  onBack: () => void;
  onSubmit: (a: { type: 'move'; to: Pos } | { type: 'wall'; wall: Wall }) => void;
}) {
  const pos = puzzle.position;
  const state: GameState = {
    size: pos.size,
    wallsPerPlayer: pos.wallsPerPlayer,
    turn: pos.turn,
    pawns: [{ ...pos.pawns[0] }, { ...pos.pawns[1] }],
    walls: pos.walls.map((w) => ({ ...w })),
    wallsRemaining: [...pos.wallsRemaining],
    winner: null,
    isOver: false,
    moveNumber: puzzle.seq,
    lastAction: null,
    rulesVersion: '1.0.0',
  };
  return (
    <div>
      <button onClick={onBack} style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 14, marginBottom: 12 }}>
        ← All drills
      </button>
      <p style={{ color: 'var(--muted)', margin: '0 0 12px' }}>{pos.prompt}</p>
      <div style={{ maxWidth: 560 }}>
        <GameBoard
          state={state}
          humanSeats={[pos.turn]}
          interactive={!busy && !(verdict?.solved ?? false)}
          onMove={(to) => void onSubmit({ type: 'move', to })}
          onWall={(wall) => void onSubmit({ type: 'wall', wall })}
        />
      </div>
      <div style={{ marginTop: 12 }}>
        {verdict === null ? (
          <p style={{ color: 'var(--muted)' }}>Play a move or place a wall — beat the reference line.</p>
        ) : verdict.solved ? (
          <p><Badge tone="good">Fixed!</Badge> <span style={{ color: 'var(--muted)', fontSize: 14 }}>Reference was {verdict.best}.</span></p>
        ) : (
          <p><Badge tone="warn">Not quite — try again.</Badge></p>
        )}
      </div>
    </div>
  );
}
