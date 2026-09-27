/**
 * Deterministic game review from engine facts only.
 *
 * For every ply, the played action is compared against a fixed-strength
 * reference search. Labels (GREAT_WALL, WALL_BLUNDER, PATH_BLUNDER,
 * TEMPO_LOSS, MISSED_CHOKE, CLUTCH) are pure functions of path lengths —
 * an LLM may later *explain* them, but never *decide* them.
 */
import { applyMove, createGame, getLegalMoves } from '../rules/game.js';
import { findShortestPath } from '../pathfinding/bfs.js';
import { chooseBotAction } from '../bots/search.js';
import { BALANCED_WEIGHTS } from '../bots/evaluate.js';
import type { Action, GameConfig, GameState, PlayerIndex } from '../core/types.js';

export type ReviewLabel =
  | 'GREAT_WALL'
  | 'WALL_BLUNDER'
  | 'PATH_BLUNDER'
  | 'TEMPO_LOSS'
  | 'MISSED_CHOKE'
  | 'CLUTCH';

export interface ReviewedMove {
  seq: number;
  by: PlayerIndex;
  action: Action;
  labels: ReviewLabel[];
  ownBefore: number;
  ownAfter: number;
  oppBefore: number;
  oppAfter: number;
  /** Reference best action in compact notation (e.g. "move 3,4" / "wall h 2,2"). */
  best: string;
}

export interface GameReview {
  moves: ReviewedMove[];
  summary: {
    greatWalls: [number, number];
    wallBlunders: [number, number];
    pathBlunders: [number, number];
    tempoLosses: [number, number];
    missedChokes: [number, number];
    /** Heuristic 5–100 score per player (experimental, not a skill rating). */
    score: [number, number];
  };
}

export function describeAction(a: Action): string {
  return a.type === 'move' ? `move ${a.to.r},${a.to.c}` : `wall ${a.wall.orientation} ${a.wall.r},${a.wall.c}`;
}

function pathLen(state: GameState, player: PlayerIndex): number {
  const l = findShortestPath(state, player).length;
  return l < 0 ? 999 : l;
}

const REF_OPTS = {
  weights: BALANCED_WEIGHTS,
  wallCandidates: 24,
  noise: 0,
  wallBias: 1,
  replySearch: false,
  budgetMs: 100,
};

export interface ReviewOptions {
  /** Reference wall candidates per ply (fewer = faster, coarser). */
  wallCandidates?: number;
  /** Reference search budget per ply in ms. */
  budgetMs?: number;
  /** Reference seed base (deterministic). */
  seedBase?: number;
}

/**
 * Review a completed action list from a fresh game.
 * Deterministic: reference search uses seed = seedBase + seq.
 */
export function reviewGame(config: GameConfig, actions: readonly Action[], seedBase = 1, opts: ReviewOptions = {}): GameReview {
  let state = createGame(config, seedBase);
  const moves: ReviewedMove[] = [];
  const tally = {
    greatWalls: [0, 0] as [number, number],
    wallBlunders: [0, 0] as [number, number],
    pathBlunders: [0, 0] as [number, number],
    tempoLosses: [0, 0] as [number, number],
    missedChokes: [0, 0] as [number, number],
  };

  const refBase = opts.seedBase ?? seedBase;
  actions.forEach((action, seq) => {
    const mover = state.turn;
    const other = (1 - mover) as PlayerIndex;
    const ownBefore = pathLen(state, mover);
    const oppBefore = pathLen(state, other);

    const played = applyMove(state, action).state;
    const ownAfter = pathLen(played, mover);
    const oppAfter = pathLen(played, other);

    const best = chooseBotAction(state, {
      ...REF_OPTS,
      ...(opts.wallCandidates !== undefined ? { wallCandidates: opts.wallCandidates } : {}),
      ...(opts.budgetMs !== undefined ? { budgetMs: opts.budgetMs } : {}),
      seed: refBase * 100003 + seq,
    }).action;
    const bestState = applyMove(state, best).state;
    const bestOwnAfter = pathLen(bestState, mover);
    const bestOppAfter = pathLen(bestState, other);

    const labels: ReviewLabel[] = [];
    if (played.isOver && played.winner === mover) {
      labels.push('CLUTCH');
    } else if (action.type === 'wall') {
      const gain = oppAfter - oppBefore;
      const cost = ownAfter - ownBefore;
      if (gain >= 4 && cost <= 1) labels.push('GREAT_WALL');
      else if (gain <= 0) labels.push('WALL_BLUNDER');
    } else {
      const diff = ownAfter - bestOwnAfter;
      if (diff >= 2) labels.push('PATH_BLUNDER');
      else if (diff >= 1 && ownAfter >= ownBefore) labels.push('TEMPO_LOSS');
      void best;
    }

    // Missed choke is independent of what was played.
    if (best.type === 'wall' && bestOppAfter - oppBefore >= 4 && oppAfter - oppBefore <= 1) {
      labels.push('MISSED_CHOKE');
    }

    for (const l of labels) {
      if (l === 'GREAT_WALL') tally.greatWalls[mover]++;
      else if (l === 'WALL_BLUNDER') tally.wallBlunders[mover]++;
      else if (l === 'PATH_BLUNDER') tally.pathBlunders[mover]++;
      else if (l === 'TEMPO_LOSS') tally.tempoLosses[mover]++;
      else if (l === 'MISSED_CHOKE') tally.missedChokes[mover]++;
    }

    moves.push({
      seq, by: mover, action, labels,
      ownBefore, ownAfter, oppBefore, oppAfter,
      best: describeAction(best),
    });
    state = played;
  });

  const score = (p: 0 | 1): number => {
    const v = 100
      - 8 * (tally.wallBlunders[p] + tally.pathBlunders[p])
      - 3 * (tally.tempoLosses[p] + tally.missedChokes[p])
      + 2 * tally.greatWalls[p];
    return Math.min(100, Math.max(5, Math.round(v)));
  };

  return {
    moves,
    summary: {
      ...tally,
      score: [score(0), score(1)],
    },
  };
}

/** Legal-move count proxy for mobility displays. */
export function mobilityOf(state: GameState, player: PlayerIndex): number {
  return getLegalMoves(state, player).length;
}
