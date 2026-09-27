/**
 * Deterministic game review display. Labels come from engine facts
 * (path lengths before/after vs a reference search) — see
 * engine/typescript/review/analyze.ts. Scores are heuristic, not ratings.
 */
import { api } from '../../lib/api.js';
import { Badge, Card, ErrorBox, Spinner } from '../ui/primitives.js';
import { useEffect, useState } from 'react';

const LABEL_TONE: Record<string, 'good' | 'bad' | 'warn' | 'info' | 'neutral'> = {
  GREAT_WALL: 'good',
  CLUTCH: 'good',
  WALL_BLUNDER: 'bad',
  PATH_BLUNDER: 'bad',
  TEMPO_LOSS: 'warn',
  MISSED_CHOKE: 'warn',
};

function labelText(l: string): string {
  return l.split('_').map((w) => w[0] + w.slice(1).toLowerCase()).join(' ');
}

type Review = Awaited<ReturnType<typeof api.review>>;
type Move = Review['moves'][number];

export default function ReviewPanel({ gameId }: { gameId: string }) {
  const [review, setReview] = useState<Review | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [coachFor, setCoachFor] = useState<number | null>(null);
  const [coachText, setCoachText] = useState<Record<number, string>>({});
  const [coachBusy, setCoachBusy] = useState(false);

  async function askCoach(m: Move) {
    setCoachBusy(true);
    try {
      const action = m.action.type === 'move'
        ? `move ${m.action.to.r},${m.action.to.c}`
        : `wall ${m.action.wall.orientation} ${m.action.wall.r},${m.action.wall.c}`;
      const res = await api.coach({
        moveNumber: m.seq,
        playedAction: action,
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

  useEffect(() => {
    let cancelled = false;
    setReview(null);
    setError(null);
    api.review(gameId)
      .then((r) => { if (!cancelled) setReview(r); })
      .catch((err: unknown) => { if (!cancelled) setError(err instanceof Error ? err.message : 'Review unavailable'); });
    return () => { cancelled = true; };
  }, [gameId]);

  if (error !== null) return <ErrorBox message={error} />;
  if (review === null) return <Spinner />;

  const labeled = review.moves.filter((m) => m.labels.length > 0);
  return (
    <Card>
      <h3 style={{ margin: '0 0 4px' }}>Game review</h3>
      <p style={{ color: 'var(--muted)', fontSize: 13, margin: '0 0 12px' }}>
        Engine score (experimental): <strong>P1 {review.summary.score[0]}</strong> · <strong>P2 {review.summary.score[1]}</strong>
      </p>
      {labeled.length === 0
        ? <p style={{ color: 'var(--muted)', margin: 0 }}>Clean game — no blunders or standout walls detected.</p>
        : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
            {labeled.map((m) => (
              <li key={m.seq} style={{ fontSize: 14, borderTop: '1px solid var(--line)', paddingTop: 8 }}>
                <span style={{ color: 'var(--muted)' }}>Move {m.seq + 1} · P{m.by + 1}</span>{' '}
                {m.labels.map((l) => (
                  <Badge key={l} tone={LABEL_TONE[l] ?? 'neutral'}>{labelText(l)}</Badge>
                ))}{' '}
                <span style={{ color: 'var(--muted)', fontSize: 13 }}>
                  you {m.ownBefore}→{m.ownAfter}, opp {m.oppBefore}→{m.oppAfter} · best was {m.best}
                </span>
                <div style={{ marginTop: 6 }}>
                  <button
                    onClick={() => void askCoach(m)}
                    disabled={coachBusy}
                    style={{ background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 8, padding: '4px 10px', fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}
                  >
                    {coachBusy && coachFor === null ? 'Asking…' : 'Ask AI coach'}
                  </button>
                  {coachFor === m.seq && coachText[m.seq] !== undefined && (
                    <p style={{ fontSize: 13, background: 'var(--surface-2)', borderRadius: 8, padding: '8px 10px', margin: '6px 0 0' }}>
                      {coachText[m.seq]}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
    </Card>
  );
}
