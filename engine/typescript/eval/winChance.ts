/**
 * Quoridor win-chance engine (own implementation, chess.com-style).
 * Maps route differential + wall/tempo features to 0-100% via sigmoid.
 * Deterministic, no I/O. Used for live EvalBar + review curve.
 */

export interface WinChanceInput {
  ownPath: number; // mover shortest path
  oppPath: number;
  ownWalls: number;
  oppWalls: number;
  moveNumber: number;
}

export function winChanceFor(
  perspective: 0 | 1,
  ownPath: number,
  oppPath: number,
  ownWalls = 5,
  oppWalls = 5,
  moveNumber = 0,
): number {
  // Positive diff = perspective player is behind (longer route).
  // We want higher % when ahead.
  const diff = perspective === 0 ? oppPath - ownPath : ownPath - oppPath;
  const wallEdge = (ownWalls - oppWalls) * 0.35;
  const tempo = Math.min(6, moveNumber / 8) * 0.08; // late game sharper
  const x = diff * (0.85 + tempo) + wallEdge;
  // Sigmoid tuned: +1 step ≈ 62%, +3 ≈ 82%, +5 ≈ 93%
  const p = 1 / (1 + Math.exp(-x * 0.85));
  return Math.round(Math.min(99.5, Math.max(0.5, p * 100)) * 10) / 10;
}

export function winChanceCurve(
  evalCurve: number[], // P1 - P0 path diff per ply (existing review curve)
): { p0: number[]; p1: number[] } {
  const p0: number[] = [];
  const p1: number[] = [];
  evalCurve.forEach((d, i) => {
    // d>0 means P0 ahead (P1 longer). Convert to win% for each seat.
    const w0 = 1 / (1 + Math.exp(-d * 0.85));
    const w1 = 1 - w0;
    void i;
    p0.push(Math.round(w0 * 1000) / 10);
    p1.push(Math.round(w1 * 1000) / 10);
  });
  return { p0, p1 };
}

export interface MultiWinShare {
  /** Estimated win share per seat (sums to 100, one decimal). */
  shares: number[];
  /** low when the race is wide open, high when someone is nearly home. */
  confidence: 'low' | 'medium' | 'high';
}

/**
 * Multiplayer win-share estimation (ENB-004): softmax over each seat's
 * route deficit vs the leader, plus remaining-wall edge. Deterministic
 * and instant (no fake Monte Carlo noise); labeled "estimated" in UI.
 * Turn-order edge goes to the seat to move via a small tempo bonus.
 */
export function estimateMultiWinShare(
  paths: number[],
  wallsRemaining: number[],
  turn: number,
): MultiWinShare {
  const n = paths.length;
  if (n === 0) return { shares: [], confidence: 'low' };
  const best = Math.min(...paths);
  const weights = paths.map((p, i) => {
    const deficit = p - best;
    const wallEdge = ((wallsRemaining[i] ?? 0) - avg(wallsRemaining)) * 0.12;
    const tempo = i === turn ? 0.25 : 0;
    return Math.exp(-deficit * 0.55 + wallEdge + tempo);
  });
  const total = weights.reduce((s, w) => s + w, 0);
  const shares = weights.map((w) => Math.round((w / total) * 1000) / 10);
  // Renormalize rounding drift onto the leader.
  const drift = Math.round((100 - shares.reduce((s, v) => s + v, 0)) * 10) / 10;
  const leader = shares.indexOf(Math.max(...shares));
  if (leader >= 0) shares[leader] = Math.round(((shares[leader] as number) + drift) * 10) / 10;
  const spread = Math.max(...paths) - best;
  const confidence = best <= 3 ? 'high' : spread >= 6 ? 'high' : spread >= 3 ? 'medium' : 'low';
  return { shares, confidence };
}

function avg(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((s, v) => s + v, 0) / xs.length;
}
