/**
 * Game review display: accuracy, route graph, classifications, retryable
 * mistakes, per-move and whole-game coach. All verdicts are engine facts
 * (see engine/typescript/review/analyze.ts); the LLM only explains them.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  applyMove,
  createGame,
  findShortestPath,
  parseBestAction,
} from '../../../../engine/typescript/index.js';
import type { Action, GameState } from '../../../../engine/typescript/core/types.js';
import { api } from '../../lib/api.js';
import { actionName } from '../../lib/coords.js';
import { Badge, Button, Card, ErrorBox, Spinner } from '../ui/primitives.js';
import GameBoard from './GameBoard.js';

const LABEL_TONE: Record<string, 'good' | 'bad' | 'warn' | 'info' | 'neutral'> = {
  GREAT_WALL: 'good',
  CLUTCH: 'good',
  WALL_BLUNDER: 'bad',
  PATH_BLUNDER: 'bad',
  TEMPO_LOSS: 'warn',
  MISSED_CHOKE: 'warn',
};

const CLASS_TONE: Record<string, 'good' | 'bad' | 'warn' | 'info' | 'neutral'> = {
  BRILLIANT: 'good',
  BEST: 'info',
  EXCELLENT: 'good',
  GOOD: 'neutral',
  INACCURACY: 'warn',
  MISTAKE: 'bad',
  BLUNDER: 'bad',
};

function labelText(l: string): string {
  return l.split('_').map((w) => w[0] + w.slice(1).toLowerCase()).join(' ');
}

type Review = Awaited<ReturnType<typeof api.review>>;
type Move = Review['moves'][number];

function EvalGraph({ curve }: { curve: number[] }) {
  const data = useMemo(() => {
    if (curve.length === 0) return null;
    const W = 560;
    const H = 110;
    const PAD = 10;
    const min = Math.min(...curve, 0);
    const max = Math.max(...curve, 0);
    const span = Math.max(1, max - min);
    const xy = curve.map((v, i) => {
      const x = PAD + (curve.length === 1 ? (W - PAD * 2) / 2 : (i / (curve.length - 1)) * (W - PAD * 2));
      const y = H - PAD - ((v - min) / span) * (H - PAD * 2);
      return { x, y };
    });
    const zeroY = H - PAD - ((0 - min) / span) * (H - PAD * 2);
    return { W, H, xy, zeroY };
  }, [curve]);
  if (data === null) return null;
  return (
    <svg viewBox={`0 0 ${data.W} ${data.H}`} role="img" aria-label="route advantage graph" style={{ width: '100%', height: 'auto', display: 'block' }}>
      <line x1={10} y1={data.zeroY} x2={data.W - 10} y2={data.zeroY} stroke="var(--line)" strokeWidth={1} strokeDasharray="4 3" />
      <polyline
        points={data.xy.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')}
        fill="none" stroke="var(--primary)" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round"
      />
      {data.xy.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={2.5} fill="var(--primary)" opacity={0.4} />
      ))}
    </svg>
  );
}

/** Interactive retry: rebuild the exact position, grade against the reference. */
function RetryBoard({ review, seq, onClose }: { review: Review; seq: number; onClose: () => void }) {
  const [attempt, setAttempt] = useState<Action | null>(null);

  const built = useMemo(() => {
    try {
      let state = createGame({ size: review.size, wallsPerPlayer: review.wallsPerPlayer });
      for (let i = 0; i < seq && i < review.moves.length; i++) {
        const m = review.moves[i];
        if (m === undefined) break;
        state = applyMove(state, m.action).state;
      }
      return { state, target: review.moves[seq] ?? null };
    } catch {
      return null;
    }
  }, [review, seq]);

  const verdict = useMemo(() => {
    if (built === null || built.target === null || attempt === null) return null;
    const me = built.state.turn;
    const other = (1 - me) as 0 | 1;
    const len = (s: GameState, p: 0 | 1): number => {
      const l = findShortestPath(s, p).length;
      return l < 0 ? 999 : l;
    };
    const ref = parseBestAction(built.target.best);
    if (ref === null) return { solved: false, detail: 'reference unavailable' };
    let refState: GameState;
    let subState: GameState;
    try {
      refState = applyMove(built.state, ref).state;
    } catch {
      return { solved: false, detail: 'reference unavailable' };
    }
    try {
      subState = applyMove(built.state, attempt).state;
    } catch {
      return { solved: false, detail: 'illegal — try a legal move or wall' };
    }
    const solved = len(subState, me) <= len(refState, me) && len(subState, other) >= len(refState, other) - 1;
    return {
      solved,
      detail: solved
        ? `Fixed! Reference was ${built.target.best}.`
        : `Not quite — your line concedes route. Reference: ${built.target.best}.`,
    };
  }, [built, attempt]);

  if (built === null || built.target === null) return <Spinner />;
  let shown = built.state;
  if (attempt !== null && verdict?.solved === true) {
    try {
      shown = applyMove(built.state, attempt).state;
    } catch {
      shown = built.state;
    }
  }
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ maxWidth: 380 }}>
        <GameBoard
          state={shown}
          humanSeats={[built.state.turn]}
          interactive={!(verdict?.solved ?? false)}
          onMove={(to) => setAttempt({ type: 'move', to })}
          onWall={(wall) => setAttempt({ type: 'wall', wall })}
          lastAction={null}
        />
      </div>
      {verdict !== null && (
        <p style={{ margin: '8px 0' }}>
          <Badge tone={verdict.solved ? 'good' : 'warn'}>{verdict.solved ? 'Fixed!' : 'Not quite'}</Badge>{' '}
          <span style={{ fontSize: 13, color: 'var(--muted)' }}>{verdict.detail}</span>
        </p>
      )}
      <div style={{ display: 'flex', gap: 8 }}>
        {attempt !== null && !(verdict?.solved ?? false) && (
          <Button size="sm" variant="ghost" onClick={() => setAttempt(null)}>Reset position</Button>
        )}
        <Button size="sm" variant="subtle" onClick={onClose}>Done</Button>
      </div>
      <p style={{ fontSize: 12, color: 'var(--muted)' }}>
        Position rebuilt from move {seq + 1} of this game
      </p>
    </div>
  );
}

export default function ReviewPanel({ gameId }: { gameId: string }) {
  const [review, setReview] = useState<Review | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [coachFor, setCoachFor] = useState<number | null>(null);
  const [coachText, setCoachText] = useState<Record<number, string>>({});
  const [coachBusy, setCoachBusy] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);
  const [summaryBusy, setSummaryBusy] = useState(false);
  const [retrySeq, setRetrySeq] = useState<number | null>(null);

  async function askCoach(m: Move) {
    if (review === null) return;
    setCoachBusy(true);
    try {
      const res = await api.coach({
        moveNumber: m.seq,
        playedAction: actionName(m.action, review.size),
        bestAction: m.best,
        ownPathBefore: m.ownBefore,
        ownPathAfter: m.ownAfter,
        oppPathBefore: m.oppBefore,
        oppPathAfter: m.oppAfter,
      });
      setCoachText((t) => ({
        ...t,
        [m.seq]: res.available && res.explanation !== undefined ? res.explanation : (res.message ?? 'Coach unavailable'),
      }));
      setCoachFor(m.seq);
    } catch (err) {
      setCoachText((t) => ({ ...t, [m.seq]: err instanceof Error ? err.message : 'Coach unavailable' }));
      setCoachFor(m.seq);
    } finally {
      setCoachBusy(false);
    }
  }

  async function askSummary() {
    setSummaryBusy(true);
    try {
      const res = await api.coachSummary(gameId);
      setSummary(res.available && res.explanation !== undefined ? res.explanation : (res.message ?? 'Coach unavailable'));
    } catch (err) {
      setSummary(err instanceof Error ? err.message : 'Coach unavailable');
    } finally {
      setSummaryBusy(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    setReview(null);
    setError(null);
    setSummary(null);
    setRetrySeq(null);
    api.review(gameId)
      .then((r) => { if (!cancelled) setReview(r); })
      .catch((err: unknown) => { if (!cancelled) setError(err instanceof Error ? err.message : 'Review unavailable'); });
    return () => { cancelled = true; };
  }, [gameId]);

  if (error !== null) return <ErrorBox message={error} />;
  if (review === null) return <Spinner />;

  const acc = review.summary.accuracy;
  const retryable = review.moves.filter((m) =>
    m.labels.some((l) => l === 'WALL_BLUNDER' || l === 'PATH_BLUNDER' || l === 'MISSED_CHOKE'),
  );

  return (
    <Card>
      <h3 style={{ margin: '0 0 4px' }}>Game review</h3>
      <div style={{ display: 'flex', gap: 16, alignItems: 'baseline', flexWrap: 'wrap', marginBottom: 8 }}>
        <span>Accuracy <strong className="font-mono">P1 {acc[0]}</strong> · <strong className="font-mono">P2 {acc[1]}</strong></span>
        <span style={{ color: 'var(--muted)', fontSize: 13 }}>
          Score (experimental): P1 {review.summary.score[0]} · P2 {review.summary.score[1]}
        </span>
      </div>
      {review.evalCurve.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <EvalGraph curve={review.evalCurve} />
          <p style={{ color: 'var(--muted)', fontSize: 12, margin: '4px 0 0' }}>
            Route pressure (P1 route − P0 route) after every move. Up favors player 1.
          </p>
        </div>
      )}
      <div style={{ marginBottom: 12 }}>
        <Button size="sm" onClick={() => void askSummary()} disabled={summaryBusy}>
          {summaryBusy ? 'Summarizing…' : 'Explain my game (AI)'}
        </Button>
        {summary !== null && (
          <p style={{ fontSize: 13, background: 'var(--surface-2)', borderRadius: 8, padding: '8px 10px' }}>{summary}</p>
        )}
      </div>
      {retryable.length === 0
        ? <p style={{ color: 'var(--muted)', margin: 0 }}>Clean game — no retryable mistakes detected.</p>
        : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
            {retryable.map((m) => (
              <li key={m.seq} style={{ fontSize: 14, borderTop: '1px solid var(--line)', paddingTop: 8 }}>
                <span style={{ color: 'var(--muted)' }}>Move {m.seq + 1} · P{m.by + 1}</span>{' '}
                <Badge tone={CLASS_TONE[m.class] ?? 'neutral'}>{labelText(m.class)}</Badge>{' '}
                {m.labels.map((l) => (
                  <Badge key={l} tone={LABEL_TONE[l] ?? 'neutral'}>{labelText(l)}</Badge>
                ))}{' '}
                <span style={{ color: 'var(--muted)', fontSize: 13 }}>
                  you {m.ownBefore}→{m.ownAfter}, opp {m.oppBefore}→{m.oppAfter} · best was {m.best}
                </span>
                <div style={{ marginTop: 6, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <Button size="sm" variant="ghost" onClick={() => setRetrySeq(retrySeq === m.seq ? null : m.seq)}>
                    {retrySeq === m.seq ? 'Hide board' : 'Try again'}
                  </Button>
                  <button
                    onClick={() => void askCoach(m)}
                    disabled={coachBusy}
                    style={{ background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 8, padding: '4px 10px', fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}
                  >
                    Ask AI coach
                  </button>
                </div>
                {retrySeq === m.seq && <RetryBoard review={review} seq={m.seq} onClose={() => setRetrySeq(null)} />}
                {coachFor === m.seq && coachText[m.seq] !== undefined && (
                  <p style={{ fontSize: 13, background: 'var(--surface-2)', borderRadius: 8, padding: '8px 10px', margin: '6px 0 0' }}>
                    {coachText[m.seq]}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
    </Card>
  );
}
