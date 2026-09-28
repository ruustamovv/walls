/**
 * Learn hub: guided curriculum (engine-graded steps), opening book mined
 * from real bot-vs-bot simulations, and a link to the position designer.
 */
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import GameBoard from '../../components/game/GameBoard.js';
import { Badge, Button, Card, EmptyState, ErrorBox, Spinner } from '../../components/ui/primitives.js';
import { api } from '../../lib/api.js';
import { useSession } from '../../stores/session.js';
import type { GameState, Pos, Wall } from '../../../../engine/typescript/core/types.js';

type Curriculum = Awaited<ReturnType<typeof api.learnCurriculum>>;
type Lesson = Curriculum['lessons'][number];
type Step = Lesson['steps'][number];

const TASK_LABEL: Record<string, string> = {
  advance: 'Shorten your route',
  'match-best': 'Match the reference',
  'wall-gain': 'Find the wall',
  finish: 'Finish the game',
};

export default function LearnPage() {
  const { user } = useSession();
  const [data, setData] = useState<Curriculum | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<{ lesson: Lesson; step: Step } | null>(null);
  const [openings, setOpenings] = useState<Awaited<ReturnType<typeof api.learnOpenings>> | null>(null);

  const load = useCallback(() => {
    api.learnCurriculum()
      .then(setData)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Curriculum unavailable'));
    api.learnOpenings().then(setOpenings).catch(() => undefined);
  }, []);
  useEffect(() => { load(); }, [load]);

  if (error !== null && data === null) return <ErrorBox message={error} />;
  if (data === null) return <Spinner />;

  const doneCount = data.lessons.reduce((n, l) => n + l.steps.filter((s) => s.solved).length, 0);
  const totalCount = data.lessons.reduce((n, l) => n + l.steps.length, 0);

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <h1 className="font-display" style={{ margin: 0 }}>Learn</h1>
        {user !== null && <Badge tone="info">{doneCount}/{totalCount} steps</Badge>}
        <span style={{ marginLeft: 'auto' }} />
        <Link to="/designer"><Button variant="ghost">Position designer</Button></Link>
      </div>

      {active !== null ? (
        <StepPlayer
          lesson={active.lesson}
          step={active.step}
          authed={user !== null}
          onBack={() => { setActive(null); load(); }}
          onNext={() => {
            const idx = active.lesson.steps.findIndex((s) => s.id === active.step.id);
            const next = active.lesson.steps[idx + 1];
            if (next !== undefined) setActive({ lesson: active.lesson, step: next });
            else {
              setActive(null);
              load();
            }
          }}
        />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(280px,1fr))', gap: 12 }}>
          {data.lessons.map((l) => {
            const done = l.steps.filter((s) => s.solved).length;
            return (
              <Card key={l.id}>
                <h3 className="font-display" style={{ margin: '0 0 4px' }}>{l.title}</h3>
                <p style={{ color: 'var(--muted)', fontSize: 14, margin: '0 0 8px' }}>{l.description}</p>
                <div style={{ height: 6, borderRadius: 999, background: 'var(--surface-2)', overflow: 'hidden', marginBottom: 12 }}>
                  <div style={{ width: `${(done / l.steps.length) * 100}%`, height: '100%', background: 'var(--good)', transition: 'width var(--dur-med) ease' }} />
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {l.steps.map((s, i) => (
                    <Button
                      key={s.id}
                      size="sm"
                      variant={s.solved ? 'subtle' : i === 0 || l.steps[i - 1]?.solved === true ? 'ghost' : 'subtle'}
                      disabled={!(s.solved || i === 0 || l.steps[i - 1]?.solved === true)}
                      onClick={() => setActive({ lesson: l, step: s })}
                    >
                      {s.solved ? '✓ ' : ''}{i + 1}. {s.title}
                    </Button>
                  ))}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <Card>
        <h2 className="font-display" style={{ margin: '0 0 4px' }}>Opening book</h2>
        <p style={{ color: 'var(--muted)', fontSize: 13, margin: '0 0 10px' }}>
          {openings === null
            ? 'Mined from bot-vs-bot simulations.'
            : `Mined from ${openings.games} simulated ${openings.board} games (${new Date(openings.generatedAt).toLocaleDateString()}). Notation: m(r,c) moves, wh/wv walls.`}
        </p>
        {openings === null ? <Spinner /> : openings.openings.length === 0 ? (
          <p style={{ color: 'var(--muted)', margin: 0 }}>No lines recorded yet.</p>
        ) : (
          <ol style={{ margin: 0, paddingLeft: 20, display: 'grid', gap: 4, fontSize: 14 }}>
            {openings.openings.slice(0, 12).map((o) => (
              <li key={o.line}>
                <code>{o.line}</code>{' '}
                <span style={{ color: 'var(--muted)' }}>{o.games} games · first-player {o.whiteWinPct}%</span>
              </li>
            ))}
          </ol>
        )}
      </Card>
    </div>
  );
}

function StepPlayer({ lesson, step, authed, onBack, onNext }: {
  lesson: Lesson;
  step: Step;
  authed: boolean;
  onBack: () => void;
  onNext: () => void;
}) {
  const [verdict, setVerdict] = useState<{ solved: boolean; detail: string; best?: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const state: GameState = {
    size: step.size,
    wallsPerPlayer: step.wallsPerPlayer,
    turn: step.turn,
    pawns: [{ ...step.pawns[0] }, { ...step.pawns[1] }],
    walls: step.walls.map((w) => ({ ...w })),
    wallsRemaining: [...step.wallsRemaining],
    winner: null,
    isOver: false,
    moveNumber: 0,
    lastAction: null,
    rulesVersion: '1.0.0',
  };

  async function submit(action: { type: 'move'; to: Pos } | { type: 'wall'; wall: Wall }) {
    if (!authed || busy || verdict?.solved === true) return;
    setBusy(true);
    try {
      const res = await api.learnAttempt(lesson.id, step.id, action);
      setVerdict(res);
    } catch (err) {
      setVerdict({ solved: false, detail: err instanceof Error ? err.message : 'Attempt failed' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
        <button onClick={onBack} style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 14 }}>
          ← {lesson.title}
        </button>
        <Badge tone="info">{TASK_LABEL[step.task] ?? step.task}</Badge>
        {step.task === 'wall-gain' && step.needGain !== null && <Badge tone="neutral">need +{step.needGain}</Badge>}
      </div>
      <h2 className="font-display" style={{ margin: '0 0 8px' }}>{step.title}</h2>
      <p style={{ color: 'var(--muted)', maxWidth: 640 }}>{step.explain}</p>
      {!authed && <p><Badge tone="warn">Log in to save progress</Badge></p>}
      <div style={{ maxWidth: 520 }}>
        <GameBoard
          state={state}
          humanSeats={[state.turn]}
          interactive={!busy && verdict?.solved !== true}
          onMove={(to) => void submit({ type: 'move', to })}
          onWall={(wall) => void submit({ type: 'wall', wall })}
        />
      </div>
      <div style={{ marginTop: 12, maxWidth: 520 }}>
        {verdict === null ? (
          <p style={{ color: 'var(--muted)' }}>Make your attempt on the board.</p>
        ) : verdict.solved ? (
          <div>
            <p><Badge tone="good">Solved!</Badge> <span style={{ fontSize: 14 }}>{verdict.detail}</span></p>
            <Button onClick={onNext}>Next step →</Button>
          </div>
        ) : (
          <p><Badge tone="warn">Not quite</Badge> <span style={{ fontSize: 14 }}>{verdict.detail}</span></p>
        )}
      </div>
    </div>
  );
}
