/**
 * One-ply (+ selective two-ply) action search for bots.
 *
 * Candidates: every legal pawn move plus a budgeted sample of legal walls.
 * Each candidate is applied and heuristically evaluated; the best-scoring
 * action wins. Optional shallow reply search for the strongest personalities
 * answers the top move candidates with the opponent's best reply.
 *
 * Deterministic given (state, seed): noise uses a mulberry32 stream, never
 * Math.random, so bot games are reproducible for calibration and review.
 */
import { applyMove, getLegalMoves } from '../rules/game.js';
import { getLegalWalls } from '../rules/walls.js';
import type { Action, GameState, PlayerIndex, Wall } from '../core/types.js';
import { evaluateFor, type EvalWeights } from './evaluate.js';

export interface SearchOptions {
  weights: EvalWeights;
  /** Max wall candidates evaluated per search (more = stronger, slower). */
  wallCandidates: number;
  /** Uniform noise added to each candidate score (personality jitter). */
  noise: number;
  /** Extra weight for wall actions (>1 = wall-happy, <1 = mover). */
  wallBias: number;
  /** When true, answer the top moves with the opponent's best reply. */
  replySearch: boolean;
  /** Hard time budget in ms (best-effort checks between candidates). */
  budgetMs: number;
  /** Seed for the deterministic noise stream. */
  seed: number;
}

/** Deterministic PRNG (mulberry32). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface ScoredAction {
  action: Action;
  score: number;
}

/**
 * Rank every wall by how much it hurts the player to move.
 * Cheaper than a full search and focuses wall candidates on choke points:
 * walls that lengthen the opponent's shortest path most come first.
 */
function rankWalls(state: GameState, player: PlayerIndex, walls: Wall[], rng: () => number, cap: number): Wall[] {
  const scored = walls.map((wall) => {
    const next = applyMove(state, { type: 'wall', wall }).state;
    // Opponent-path gain minus own-path cost: efficient walls only.
    const before = evaluateFor(state, player, { pathAdvantage: 1, wallAdvantage: 0, mobility: 0 });
    const after = evaluateFor(next, player, { pathAdvantage: 1, wallAdvantage: 0, mobility: 0 });
    return { wall, gain: after - before + rng() * 1e-6 };
  });
  scored.sort((a, b) => b.gain - a.gain);
  return scored.slice(0, Math.max(0, cap)).map((s) => s.wall);
}

function opponentBestReply(state: GameState, weights: EvalWeights, budgetMs: number, deadline: number): number {
  const other = state.turn;
  let best = -Infinity;
  for (const to of getLegalMoves(state)) {
    if (Date.now() > deadline) break;
    const next = applyMove(state, { type: 'move', to }).state;
    const s = evaluateFor(next, other, weights);
    if (s > best) best = s;
  }
  void budgetMs;
  return best === -Infinity ? 0 : best;
}

export function chooseBotAction(state: GameState, opts: SearchOptions): ScoredAction {
  const player = state.turn;
  const rng = mulberry32(opts.seed);
  const deadline = Date.now() + Math.max(1, opts.budgetMs);
  let best: ScoredAction | null = null;

  const consider = (action: Action, wallBoost: number): void => {
    const next = applyMove(state, action).state;
    let score = evaluateFor(next, player, opts.weights) + rng() * opts.noise + wallBoost;
    if (opts.replySearch && action.type === 'move' && !next.isOver && Date.now() <= deadline) {
      // Penalize moves that let the opponent reply strongly.
      score -= opponentBestReply(next, opts.weights, opts.budgetMs, deadline) * 0.5;
    }
    if (best === null || score > best.score) best = { action, score };
  };

  for (const to of getLegalMoves(state)) {
    if (Date.now() > deadline) break;
    consider({ type: 'move', to: { ...to } }, 0);
  }

  if (state.wallsRemaining[player] > 0 && Date.now() <= deadline) {
    const walls = getLegalWalls(state, player);
    const shortlist = rankWalls(state, player, walls, rng, opts.wallCandidates);
    // wallBias > 1 rewards spending walls; express as a score bonus.
    const boost = (opts.wallBias - 1) * 4;
    for (const wall of shortlist) {
      if (Date.now() > deadline) break;
      consider({ type: 'wall', wall: { ...wall } }, boost);
    }
  }

  // getLegalMoves/getLegalWalls return [] only when the game is over;
  // callers treat null as "no legal action".
  if (best === null) {
    const fallback = getLegalMoves(state)[0];
    if (fallback === undefined) throw new Error('chooseBotAction: no legal action (game over?)');
    return { action: { type: 'move', to: { ...fallback } }, score: -Infinity };
  }
  return best;
}
