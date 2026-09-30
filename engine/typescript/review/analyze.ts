/**
 * Deterministic game review from engine facts only.
 *
 * For every ply, the played action is compared against a fixed-strength
 * reference search. Labels (GREAT_WALL, WALL_BLUNDER, PATH_BLUNDER,
 * TEMPO_LOSS, MISSED_CHOKE, CLUTCH) are pure functions of path lengths —
 * an LLM may later *explain* them, but never *decide* them.
 */
import { applyMove, createGame, getLegalMoves } from '../rules/game.js';
import { findShortestPath, getPathMetrics } from '../pathfinding/bfs.js';
import { winChanceCurve } from '../eval/winChance.js';
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

/** Overall move classification (chess.com-style, engine-measured). */
export type MoveClass =
  | 'BRILLIANT'
  | 'GREAT'
  | 'BEST'
  | 'EXCELLENT'
  | 'GOOD'
  | 'BOOK'
  | 'INACCURACY'
  | 'MISTAKE'
  | 'MISS'
  | 'BLUNDER';

export interface ReviewedMove {
  seq: number;
  by: PlayerIndex;
  action: Action;
  labels: ReviewLabel[];
  /** Overall classification against the reference best. */
  class: MoveClass;
  ownBefore: number;
  ownAfter: number;
  oppBefore: number;
  oppAfter: number;
  /** Reference best action in compact notation (e.g. "move 3,4" / "wall h 2,2"). */
  best: string;
}

export interface GameReview {
  moves: ReviewedMove[];
  /** Route-differential curve (P1 path − P0 path) after every ply. */
  evalCurve: number[];
  /** Win% per ply from seat-0 perspective (0-100). Own engine. */
  winCurve: number[];
  summary: {
    greatWalls: [number, number];
    wallBlunders: [number, number];
    pathBlunders: [number, number];
    tempoLosses: [number, number];
    missedChokes: [number, number];
    /** Heuristic 5–100 score per player (experimental, not a skill rating). */
    score: [number, number];
    /** Accuracy 3–100 per player from move classifications. */
    accuracy: [number, number];
    classCounts: [{ [K in MoveClass]: number }, { [K in MoveClass]: number }];
  };
}

export function describeAction(a: Action): string {
  return a.type === 'move' ? `move ${a.to.r},${a.to.c}` : `wall ${a.wall.orientation} ${a.wall.r},${a.wall.c}`;
}

/** Parse a describeAction() string back into an action. */
export function parseBestAction(best: string): Action | null {
  const move = /^move (\d+),(\d+)$/.exec(best);
  if (move !== null) return { type: 'move', to: { r: Number(move[1]), c: Number(move[2]) } };
  const wall = /^wall ([hv]) (\d+),(\d+)$/.exec(best);
  if (wall !== null) {
    return { type: 'wall', wall: { orientation: wall[1] as 'h' | 'v', r: Number(wall[2]), c: Number(wall[3]) } };
  }
  return null;
}

const CLASS_SCORE: Record<MoveClass, number> = {
  BRILLIANT: 2,
  GREAT: 1.8,
  BEST: 2,
  EXCELLENT: 1.5,
  GOOD: 1,
  BOOK: 1.2,
  INACCURACY: 0.5,
  MISTAKE: -1,
  MISS: -1.2,
  BLUNDER: -2,
};

function emptyClassCounts(): { [K in MoveClass]: number } {
  return { BRILLIANT: 0, GREAT: 0, BEST: 0, EXCELLENT: 0, GOOD: 0, BOOK: 0, INACCURACY: 0, MISTAKE: 0, MISS: 0, BLUNDER: 0 };
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
  const evalCurve: number[] = [];
  const classCounts = [emptyClassCounts(), emptyClassCounts()] as [
    { [K in MoveClass]: number },
    { [K in MoveClass]: number },
  ];
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
    }

    // Missed choke is independent of what was played.
    if (best.type === 'wall' && bestOppAfter - oppBefore >= 4 && oppAfter - oppBefore <= 1) {
      labels.push('MISSED_CHOKE');
    }

    // Overall classification: total route-steps conceded vs the reference.
    // chess.com-style: Brilliant (sacrifice/game-winning), Great (only good / game-changing),
    // Best, Excellent, Good, Book (opening), Inaccuracy, Mistake, Miss, Blunder.
    const totalDiff = (ownAfter - bestOwnAfter) + (bestOppAfter - oppAfter);
    const gain = oppAfter - oppBefore;
    const isOpening = seq < 4;
    let cls: MoveClass;
    if (labels.includes('CLUTCH') || labels.includes('GREAT_WALL')) cls = 'BRILLIANT';
    else if (totalDiff <= 0 && gain >= 3 && action.type === 'wall') cls = 'GREAT';
    else if (totalDiff <= 0 && best.type === 'wall' && bestOppAfter - oppBefore >= 3) cls = 'GREAT';
    else if (totalDiff <= 0) cls = 'BEST';
    else if (isOpening && totalDiff <= 1) cls = 'BOOK';
    else if (totalDiff === 1) cls = 'EXCELLENT';
    else if (totalDiff === 2) cls = 'GOOD';
    else if (labels.includes('MISSED_CHOKE') && totalDiff <= 4) cls = 'MISS';
    else if (totalDiff <= 4) cls = 'INACCURACY';
    else if (totalDiff <= 7) cls = 'MISTAKE';
    else cls = 'BLUNDER';

    for (const l of labels) {
      if (l === 'GREAT_WALL') tally.greatWalls[mover]++;
      else if (l === 'WALL_BLUNDER') tally.wallBlunders[mover]++;
      else if (l === 'PATH_BLUNDER') tally.pathBlunders[mover]++;
      else if (l === 'TEMPO_LOSS') tally.tempoLosses[mover]++;
      else if (l === 'MISSED_CHOKE') tally.missedChokes[mover]++;
    }
    classCounts[mover][cls]++;

    moves.push({
      seq, by: mover, action, labels, class: cls,
      ownBefore, ownAfter, oppBefore, oppAfter,
      best: describeAction(best),
    });
    // Eval curve from player-0 perspective (P1 route − P0 route).
    const m = getPathMetrics(played);
    evalCurve.push(m.pathLengthB - m.pathLengthA);
    state = played;
  });

  const score = (p: 0 | 1): number => {
    const v = 100
      - 8 * (tally.wallBlunders[p] + tally.pathBlunders[p])
      - 3 * (tally.tempoLosses[p] + tally.missedChokes[p])
      + 2 * tally.greatWalls[p];
    return Math.min(100, Math.max(5, Math.round(v)));
  };

  const accuracy = (p: 0 | 1): number => {
    const counts = classCounts[p];
    const n = (Object.keys(counts) as MoveClass[]).reduce((s, k) => s + counts[k], 0);
    if (n === 0) return 100;
    const avg = (Object.keys(counts) as MoveClass[]).reduce((s, k) => s + counts[k] * CLASS_SCORE[k], 0) / n;
    return Math.min(100, Math.max(3, Math.round(50 + 25 * avg)));
  };

  return {
    moves,
    evalCurve,
    winCurve: winChanceCurve(evalCurve).p0,
    summary: {
      ...tally,
      score: [score(0), score(1)],
      accuracy: [accuracy(0), accuracy(1)],
      classCounts,
    },
  };
}

/** Legal-move count proxy for mobility displays. */
export function mobilityOf(state: GameState, player: PlayerIndex): number {
  return getLegalMoves(state, player).length;
}
