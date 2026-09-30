/**
 * Quoridor Game Review: accuracy, win% curve, !! ! ★ 👍 ✓ ?! ? ?? badges,
 * key moves + retry + coach explains (chess.com-style).
 */
import { useEffect, useMemo, useState } from 'react';
import { applyMove, createGame, findShortestPath, parseBestAction } from '../../../../engine/typescript/index.js';
import type { Action, GameState } from '../../../../engine/typescript/core/types.js';
import { api } from '../../lib/api.js';
import { actionName } from '../../lib/coords.js';
import { Avatar, Badge, Button, Card, ErrorBox, MoveBadge, Spinner } from '../ui/primitives.js';
import GameBoard from './GameBoard.js';

type Review = Awaited<ReturnType<typeof api.review>>;
type Move = Review['moves'][number];

function WinGraph({ winCurve, evalCurve }: { winCurve?: number[]; evalCurve: number[] }) {
  const fallback = useMemo(() => evalCurve.map((d: number) => 100 / (1 + Math.exp(-d * 0.85))), [evalCurve]);
  const curve = winCurve ?? fallback;
  const data = useMemo(() => {
    if (curve.length === 0) return null;
    const W = 560; const H = 110; const PAD = 10;
    const xy = curve.map((v: number, i: number) => {
      const x = PAD + (curve.length === 1 ? (W - PAD * 2) / 2 : (i / (curve.length - 1)) * (W - PAD * 2));
      const y = H - PAD - (v / 100) * (H - PAD * 2);
      return { x, y };
    });
    return { W, H, xy };
  }, [curve]);
  if (data === null) return null;
  return (
    <svg viewBox={`0 0 ${data.W} ${data.H}`} role="img" aria-label="win chance graph" style={{ width: '100%', height: 'auto', display: 'block', background: 'var(--surface-2)', borderRadius: 10 }}>
      <line x1={10} y1={55} x2={data.W - 10} y2={55} stroke="var(--line)" strokeWidth={1} strokeDasharray="4 3" />
      <polyline points={data.xy.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')} fill="none" stroke="var(--primary)" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function RetryBoard({ review, seq, onClose }: { review: Review; seq: number; onClose: () => void }) {
  const [attempt, setAttempt] = useState<Action | null>(null);
  const built = useMemo(() => {
    try {
      let state = createGame({ size: review.size, wallsPerPlayer: review.wallsPerPlayer });
      for (let i = 0; i < seq && i < review.moves.length; i++) {
        const m = review.moves[i];
        if (m === undefined) break;
        state = applyMove(state, m.action as Action).state;
      }
      return { state, target: review.moves[seq] ?? null };
    } catch { return null; }
  }, [review, seq]);
  const verdict = useMemo(() => {
    if (built === null || built.target === null || attempt === null) return null;
    const me = built.state.turn as 0 | 1;
    const other = (1 - me) as 0 | 1;
    const len = (s: GameState, p: 0 | 1): number => { const l = findShortestPath(s, p).length; return l < 0 ? 999 : l; };
    const ref = parseBestAction(built.target.best);
    if (ref === null) return { solved: false, detail: 'reference unavailable' };
    let refState: GameState; let subState: GameState;
    try { refState = applyMove(built.state, ref).state; } catch { return { solved: false, detail: 'reference unavailable' }; }
    try { subState = applyMove(built.state, attempt).state; } catch { return { solved: false, detail: 'illegal' }; }
    const solved = len(subState, me) <= len(refState, me) && len(subState, other) >= len(refState, other) - 1;
    return { solved, detail: solved ? `Fixed! Best was ${built.target.best}.` : `Not yet — best: ${built.target.best}.` };
  }, [built, attempt]);
  if (built === null || built.target === null) return <Spinner />;
  let shown = built.state;
  if (attempt !== null && verdict?.solved === true) { try { shown = applyMove(built.state, attempt).state; } catch { shown = built.state; } }
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ maxWidth: 360 }}><GameBoard state={shown as any} humanSeats={[built.state.turn as 0 | 1]} interactive={!(verdict?.solved ?? false)} onMove={(to) => setAttempt({ type: 'move', to })} onWall={(wall) => setAttempt({ type: 'wall', wall })} lastAction={null} /></div>
      {verdict !== null && <p style={{ margin: '8px 0' }}><Badge tone={verdict.solved ? 'good' : 'warn'}>{verdict.solved ? 'Fixed!' : 'Retry'}</Badge> <span style={{ fontSize: 13, color: 'var(--muted)' }}>{verdict.detail}</span></p>}
      <div style={{ display: 'flex', gap: 8 }}>
        {attempt !== null && !(verdict?.solved ?? false) && <Button size="sm" variant="ghost" onClick={() => setAttempt(null)}>Reset</Button>}
        <Button size="sm" variant="subtle" onClick={onClose}>Done</Button>
      </div>
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
      const res = await api.coach({ moveNumber: m.seq, playedAction: actionName(m.action as any, review.size), bestAction: m.best, ownPathBefore: m.ownBefore, ownPathAfter: m.ownAfter, oppPathBefore: m.oppBefore, oppPathAfter: m.oppAfter });
      setCoachText((t) => ({ ...t, [m.seq]: res.available && res.explanation !== undefined ? res.explanation : (res.message ?? 'Coach unavailable (add GROQ_API_KEY)') }));
      setCoachFor(m.seq);
    } catch (err) {
      setCoachText((t) => ({ ...t, [m.seq]: err instanceof Error ? err.message : 'Coach unavailable' }));
      setCoachFor(m.seq);
    } finally { setCoachBusy(false); }
  }
  async function askSummary() {
    setSummaryBusy(true);
    try {
      const res = await api.coachSummary(gameId);
      setSummary(res.available && res.explanation !== undefined ? res.explanation : (res.message ?? 'Coach unavailable'));
    } catch (err) { setSummary(err instanceof Error ? err.message : 'Coach unavailable'); }
    finally { setSummaryBusy(false); }
  }
  useEffect(() => {
    let cancelled = false;
    setReview(null); setError(null); setSummary(null); setRetrySeq(null);
    api.review(gameId).then((r) => { if (!cancelled) setReview(r as Review); }).catch((err: unknown) => { if (!cancelled) setError(err instanceof Error ? err.message : 'Review unavailable'); });
    return () => { cancelled = true; };
  }, [gameId]);

  if (error !== null) return <ErrorBox message={error} />;
  if (review === null) return <Spinner />;
  const acc = (review.summary as any).accuracy as [number, number];
  const counts = (review.summary as any).classCounts as Record<string, number>[];
  const keyMoves = review.moves.filter((m) => ['BRILLIANT', 'GREAT', 'BLUNDER', 'MISTAKE', 'MISS'].includes(m.class) || m.labels.length > 0).slice(0, 12);

  return (
    <Card>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 8 }}>
        <Avatar name="Coach" size={34} />
        <div><h3 style={{ margin: 0 }}>Review</h3><span style={{ fontSize: 12, color: 'var(--muted)' }}>Quoridor engine · free preview</span></div>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <span className="font-mono" style={{ fontWeight: 800 }}>You {acc[0]}</span>
          <span className="font-mono" style={{ color: 'var(--muted)' }}>{acc[1]}</span>
        </span>
      </div>
      <WinGraph winCurve={(review as any).winCurve} evalCurve={review.evalCurve} />
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '10px 0' }}>
        {['BRILLIANT', 'GREAT', 'BEST', 'EXCELLENT', 'GOOD', 'BOOK', 'INACCURACY', 'MISTAKE', 'MISS', 'BLUNDER'].map((c) => (
          <span key={c} style={{ display: 'inline-flex', gap: 5, alignItems: 'center', fontSize: 12, background: 'var(--surface-2)', borderRadius: 999, padding: '3px 8px' }}>
            <MoveBadge kind={c} size={18} />{(counts[0]?.[c] ?? 0) + (counts[1]?.[c] ?? 0)}
          </span>
        ))}
      </div>
      <Button size="sm" onClick={() => void askSummary()} disabled={summaryBusy}>{summaryBusy ? '…' : 'Coach explains game'}</Button>
      {summary !== null && <p style={{ fontSize: 13, background: 'var(--surface-2)', borderRadius: 8, padding: '8px 10px' }}>{summary}</p>}
      <ul style={{ listStyle: 'none', margin: '10px 0 0', padding: 0, display: 'grid', gap: 8 }}>
        {keyMoves.map((m) => (
          <li key={m.seq} style={{ fontSize: 13, borderTop: '1px solid var(--line)', paddingTop: 8, display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            <MoveBadge kind={m.class} size={24} />
            <div style={{ flex: 1 }}>
              <span style={{ color: 'var(--muted)' }}>{m.seq + 1} · P{m.by + 1}</span> <strong>{m.class.toLowerCase()}</strong>{' '}
              <span style={{ color: 'var(--muted)' }}>{m.ownBefore}→{m.ownAfter} · best {m.best}</span>
              <div style={{ marginTop: 6, display: 'flex', gap: 8 }}>
                <Button size="sm" variant="ghost" onClick={() => setRetrySeq(retrySeq === m.seq ? null : m.seq)}>{retrySeq === m.seq ? 'Hide' : 'Retry'}</Button>
                <button onClick={() => void askCoach(m)} disabled={coachBusy} style={{ background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 8, padding: '4px 10px', fontSize: 13, fontWeight: 700 }}>Coach</button>
              </div>
              {retrySeq === m.seq && <RetryBoard review={review} seq={m.seq} onClose={() => setRetrySeq(null)} />}
              {coachFor === m.seq && coachText[m.seq] !== undefined && <p style={{ fontSize: 13, background: 'var(--primary-soft)', borderRadius: 8, padding: '8px 10px' }}>{coachText[m.seq]}</p>}
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}
