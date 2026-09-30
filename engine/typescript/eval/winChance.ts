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
