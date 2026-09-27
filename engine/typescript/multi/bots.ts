/**
 * N-player bot search: 1-ply over moves + ranked wall shortlist.
 * Evaluation from the mover's perspective: own route vs the BEST rival
 * route (the closest finisher is the threat), plus wall stock and mobility.
 * Deterministic given (state, seed) via mulberry32.
 */
import { applyMultiMove, type MultiApplyResult } from './game.js';
import { shortestToSide } from './board.js';
import { getMultiLegalMoves } from './moves.js';
import { getMultiLegalWalls } from './walls.js';
import type { MultiAction, MultiState, MultiWall } from './types.js';

export interface MultiBotOpts {
  wallCandidates: number;
  noise: number;
  wallBias: number;
  budgetMs: number;
  seed: number;
}

export const MULTI_BOT_DEFAULT: MultiBotOpts = {
  wallCandidates: 24,
  noise: 2,
  wallBias: 1,
  budgetMs: 120,
  seed: 1,
};

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function routeLen(walls: MultiState['walls'], size: number, pawn: { r: number; c: number }, side: MultiState['sides'][number]): number {
  const l = shortestToSide(walls, size, pawn, side).length;
  return l < 0 ? 999 : l;
}

function evaluateMulti(state: MultiState, player: number): number {
  const me = state.pawns[player];
  const mySide = state.sides[player];
  if (me === undefined || mySide === undefined) return -99999;
  if (state.isOver) {
    if (state.winner === player) return 100000 + (state.wallsRemaining[player] ?? 0);
    return -100000;
  }
  const own = routeLen(state.walls, state.size, me, mySide);
  let bestRival = 999;
  for (let p = 0; p < state.players; p++) {
    if (p === player) continue;
    const pawn = state.pawns[p];
    const side = state.sides[p];
    if (pawn === undefined || side === undefined) continue;
    const l = routeLen(state.walls, state.size, pawn, side);
    if (l < bestRival) bestRival = l;
  }
  const mobility = getMultiLegalMoves(state, player).length;
  const stock = state.wallsRemaining[player] ?? 0;
  return (bestRival - own) * 10 + stock * 0.6 + mobility * 0.4;
}

export function chooseMultiBotAction(state: MultiState, opts: Partial<MultiBotOpts> = {}): MultiAction {
  const o: MultiBotOpts = { ...MULTI_BOT_DEFAULT, ...opts };
  const player = state.turn;
  const rng = mulberry32(o.seed);
  const deadline = Date.now() + Math.max(1, o.budgetMs);
  let best: MultiAction | null = null;
  let bestScore = -Infinity;

  const consider = (action: MultiAction, boost: number): MultiApplyResult | null => {
    let next: MultiApplyResult;
    try {
      next = applyMultiMove(state, action);
    } catch {
      return null;
    }
    const score = evaluateMulti(next.state, player) + rng() * o.noise + boost;
    if (score > bestScore) {
      bestScore = score;
      best = action;
    }
    return next;
  };

  for (const to of getMultiLegalMoves(state, player)) {
    if (Date.now() > deadline) break;
    consider({ type: 'move', to: { ...to } }, 0);
  }

  if ((state.wallsRemaining[player] ?? 0) > 0 && Date.now() <= deadline) {
    // Rank walls by rival-route damage, then evaluate the shortlist fully.
    const ranked: { wall: MultiWall; gain: number }[] = [];
    for (const wall of getMultiLegalWalls(state, player)) {
      if (Date.now() > deadline) break;
      let next: MultiApplyResult;
      try {
        next = applyMultiMove(state, { type: 'wall', wall });
      } catch {
        continue;
      }
      ranked.push({ wall, gain: evaluateMulti(next.state, player) - evaluateMulti(state, player) });
    }
    ranked.sort((a, b) => b.gain - a.gain);
    const boost = (o.wallBias - 1) * 4;
    for (const { wall } of ranked.slice(0, Math.max(0, o.wallCandidates))) {
      if (Date.now() > deadline) break;
      consider({ type: 'wall', wall: { ...wall } }, boost);
    }
  }

  if (best === null) {
    const fallback = getMultiLegalMoves(state, player)[0];
    if (fallback === undefined) throw new Error('chooseMultiBotAction: no legal action (game over?)');
    return { type: 'move', to: { ...fallback } };
  }
  return best;
}
