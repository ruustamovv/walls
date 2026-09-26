/**
 * Heuristic evaluation for wall-and-pawn positions.
 *
 * Pure and deterministic: same state + same weights always yield the same
 * score. Scores are expressed from the perspective of `player`
 * (positive = good for `player`). Units are roughly "path steps".
 *
 * Features:
 * - pathAdvantage: opponent shortest path minus own shortest path.
 * - wallAdvantage: own remaining walls minus opponent's (walls are tempo).
 * - mobility: legal pawn-move count difference (route diversity proxy).
 * - terminal: large bonus when the position is already won/lost.
 */
import { getLegalMoves } from '../rules/moves.js';
import { getPathMetrics } from '../pathfinding/bfs.js';
import type { GameState, PlayerIndex } from '../core/types.js';

export interface EvalWeights {
  /** Weight of (oppPath - ownPath). */
  pathAdvantage: number;
  /** Weight of (ownWalls - oppWalls). */
  wallAdvantage: number;
  /** Weight of (ownMobility - oppMobility). */
  mobility: number;
}

export const BALANCED_WEIGHTS: EvalWeights = {
  pathAdvantage: 10,
  wallAdvantage: 0.6,
  mobility: 0.4,
};

const WIN_SCORE = 100000;

export function evaluateFor(state: GameState, player: PlayerIndex, weights: EvalWeights = BALANCED_WEIGHTS): number {
  const other = (1 - player) as PlayerIndex;
  if (state.isOver) {
    if (state.winner === player) return WIN_SCORE + state.wallsRemaining[player];
    if (state.winner === other) return -WIN_SCORE - state.wallsRemaining[other];
    return 0;
  }
  const metrics = getPathMetrics(state);
  const ownPath = player === 0 ? metrics.pathLengthA : metrics.pathLengthB;
  const oppPath = player === 0 ? metrics.pathLengthB : metrics.pathLengthA;
  // Unreachable legs cannot occur in legal play (no-seal rule), but guard
  // anyway so a malformed probe never yields NaN.
  const pathAdvantage = (oppPath < 0 ? 0 : oppPath) - (ownPath < 0 ? 999 : ownPath);
  const wallAdvantage = state.wallsRemaining[player] - state.wallsRemaining[other];
  const mobility = getLegalMoves(state, player).length - getLegalMoves(state, other).length;
  return (
    pathAdvantage * weights.pathAdvantage +
    wallAdvantage * weights.wallAdvantage +
    mobility * weights.mobility
  );
}
