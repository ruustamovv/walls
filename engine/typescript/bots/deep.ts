/**
 * Deterministic depth-limited negamax with alpha-beta pruning (BOT-005).
 *
 * Why this exists: the original one-ply heuristic max gave higher tiers a
 * bigger wall sample and a longer wall clock, but no lookahead at all — so
 * "stronger" bots were not measurably stronger (see the 2026-09-30 round-robin
 * where a 1200 bot outscored a 2600 bot). Strength here comes from real
 * adversarial replies, and negation keeps every ply in ONE frame: the
 * side-to-move perspective of `evaluateFor`.
 *
 * Determinism: the search is bounded by a NODE budget, never by elapsed time,
 * so the same (state, seed, options) returns the same action on any machine.
 * The optional `timeCapMs` is only a runaway guard and is reported through
 * `truncated` when it (or the node budget) fires.
 */
import { applyMove, getLegalMoves } from '../rules/game.js';
import { getLegalWalls } from '../rules/walls.js';
import { findShortestPath } from '../pathfinding/bfs.js';
import { evaluateFor, type EvalWeights } from './evaluate.js';
import { mulberry32 } from './search.js';
import type { Action, GameState, PlayerIndex, Wall } from '../core/types.js';

/**
 * Quiescence swing threshold in eval units. Path steps weigh ~12–13 units,
 * so 25 ≈ a 2-step route swing — a just-played choke, exactly the leaf the
 * search must not stop on.
 */
export const QUIESCE_SWING = 25;
/** Quiescence extensions granted per root path (bounds the extra work). */
export const QUIESCE_EXTENSIONS = 3;

export interface DeepSearchOptions {  weights: EvalWeights;
  /** Plies of adversarial lookahead. 1 = static heuristic max. */
  depth: number;
  /** Wall candidates considered at the root. */
  wallCandidates: number;
  /** Wall candidates inside the tree (default 12 — keeps depth 3 affordable). */
  innerWallCandidates?: number;
  /** Deterministic node budget — the machine-independent strength knob. */
  maxNodes: number;
  /**
   * Root-only style bonus for playing a wall (>1 wall-happy, <1 runner).
   * Applied at the root ONLY: inside the tree it would distort minimax.
   */
  wallBias: number;
  /** 0 = always play the search's favourite; higher = more plausible slips. */
  noise: number;
  seed: number;
  /** Runaway guard in ms (optional). The node budget is the real bound. */
  timeCapMs?: number;
}

export interface DeepResult {
  action: Action;
  /** Search score of the chosen move, in eval units. */
  score: number;
  /** Nodes expanded. */
  nodes: number;
  /** True when a budget/guard cut the search short. */
  truncated: boolean;
}

interface Frame {
  opts: DeepSearchOptions;
  nodes: number;
  truncated: boolean;
  deadline: number;
}

interface Candidate {
  action: Action;
  /** Side-to-move eval after the action (also the search ordering key). */
  static: number;
}

function pathLen(state: GameState, player: PlayerIndex): number {
  const l = findShortestPath(state, player).length;
  return l < 0 ? 999 : l;
}

function staticEval(state: GameState, frame: Frame): number {
  return evaluateFor(state, state.turn, frame.opts.weights);
}

/**
 * Walls ranked by how much they lengthen the opponent's route.
 * Ties are broken by seeded jitter assigned BEFORE sorting, so the ordering is
 * reproducible without depending on comparator side effects.
 */
function rankWalls(state: GameState, cap: number, rng: () => number): Wall[] {
  const opp = (1 - state.turn) as PlayerIndex;
  const before = pathLen(state, opp);
  const scored: { wall: Wall; gain: number; jitter: number }[] = [];
  for (const wall of getLegalWalls(state, state.turn)) {
    const next = applyMove(state, { type: 'wall', wall }).state;
    scored.push({ wall, gain: pathLen(next, opp) - before, jitter: rng() });
  }
  scored.sort((a, b) => (b.gain - a.gain) || (a.jitter - b.jitter));
  return scored.slice(0, Math.max(0, cap)).map((s) => s.wall);
}

/** All legal actions with their static scores, best-first for pruning. */
function orderedActions(state: GameState, frame: Frame, wallCap: number): Candidate[] {
  const me = state.turn;
  const rng = mulberry32((frame.opts.seed ^ 0x9e3779b9 ^ frame.nodes) >>> 0);
  const out: Candidate[] = [];
  for (const to of getLegalMoves(state)) {
    const action: Action = { type: 'move', to: { ...to } };
    out.push({ action, static: staticEval(applyMove(state, action).state, frame) });
  }
  if (state.wallsRemaining[me] > 0 && wallCap > 0) {
    for (const wall of rankWalls(state, wallCap, rng)) {
      const action: Action = { type: 'wall', wall: { ...wall } };
      out.push({ action, static: staticEval(applyMove(state, action).state, frame) });
    }
  }
  out.sort((a, b) => b.static - a.static);
  return out;
}

function negamax(state: GameState, depth: number, alphaIn: number, betaIn: number, frame: Frame, parentStatic: number, extLeft: number): number {
  if (state.isOver) return staticEval(state, frame);
  if (depth <= 0) {
    const s = staticEval(state, frame);
    // Quiescence: a leaf right after a big swing (a just-played choke) is
    // the worst place to stop thinking — extend one ply so the search sees
    // the reply instead of the mirage. Bounded by extLeft and the node
    // budget, so it can never run away.
    if (extLeft > 0 && Math.abs(s - parentStatic) > QUIESCE_SWING && frame.nodes < frame.opts.maxNodes) {
      return searchChildren(state, 1, alphaIn, betaIn, frame, extLeft - 1);
    }
    return s;
  }
  return searchChildren(state, depth, alphaIn, betaIn, frame, extLeft);
}

/** Expand every candidate once with alpha-beta. Shared by depth and quiescence. */
function searchChildren(state: GameState, depth: number, alphaIn: number, betaIn: number, frame: Frame, extLeft: number): number {
  frame.nodes++;
  if (frame.nodes > frame.opts.maxNodes) {
    frame.truncated = true;
    return staticEval(state, frame);
  }
  if (frame.deadline !== Number.POSITIVE_INFINITY && frame.nodes % 64 === 0 && Date.now() > frame.deadline) {
    frame.truncated = true;
    return staticEval(state, frame);
  }
  const inner = frame.opts.innerWallCandidates ?? 12;
  const candidates = orderedActions(state, frame, inner);
  if (candidates.length === 0) return staticEval(state, frame);
  let alpha = alphaIn;
  let best = -Infinity;
  for (const c of candidates) {
    const next = applyMove(state, c.action).state;
    const score = -negamax(next, depth - 1, -betaIn, -alpha, frame, c.static, extLeft);
    if (score > best) best = score;
    if (best > alpha) alpha = best;
    if (alpha >= betaIn) break;
  }
  return best;
}

/**
 * Choose an action with depth-limited negamax. Depth 1 reproduces the old
 * one-ply behaviour (pure static eval), so it is a safe drop-in.
 */
export function chooseDeepAction(state: GameState, opts: DeepSearchOptions): DeepResult {
  const frame: Frame = {
    opts,
    nodes: 0,
    truncated: false,
    deadline: opts.timeCapMs === undefined ? Number.POSITIVE_INFINITY : Date.now() + Math.max(1, opts.timeCapMs),
  };
  const root = orderedActions(state, frame, opts.wallCandidates);
  if (root.length === 0) throw new Error('chooseDeepAction: no legal action (game over?)');

  const depth = Math.max(1, Math.floor(opts.depth));
  const boost = (opts.wallBias - 1) * 4;
  const scored: { action: Action; score: number }[] = [];
  let best: { action: Action; score: number } | null = null;
  let alpha = -Infinity;
  for (const c of root) {
    const next = applyMove(state, c.action).state;
    const raw = depth <= 1
      ? c.static
      : -negamax(next, depth - 1, -Infinity, -alpha, frame, c.static, QUIESCE_EXTENSIONS);
    const score = raw + (c.action.type === 'wall' ? boost : 0);
    scored.push({ action: c.action, score });
    if (best === null || score > best.score) best = { action: c.action, score };
    if (score > alpha) alpha = score;
  }
  scored.sort((a, b) => b.score - a.score);

  // Deterministic "human" slip: with probability p the bot plays its 2nd or
  // 3rd best instead of the favourite. p=0 for the top tiers.
  const top = scored[0] as { action: Action; score: number };
  const p = Math.max(0, Math.min(1, opts.noise / 100));
  let index = 0;
  if (p > 0 && scored.length > 1) {
    const window = Math.min(scored.length, 3);
    const rng = mulberry32(opts.seed >>> 0);
    if (rng() < p) index = 1 + Math.floor(rng() * (window - 1));
  }
  const chosen = scored[index] ?? top;
  return { action: chosen.action, score: chosen.score, nodes: frame.nodes, truncated: frame.truncated };
}