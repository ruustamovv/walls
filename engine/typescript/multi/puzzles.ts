/**
 * Multiplayer "choke the leader" puzzles (TRN-004).
 *
 * Deterministic per seed: a multi-bot line is played, then positions are
 * scanned for a side-to-move wall that lengthens the CURRENT LEADER's
 * shortest route by 3+ steps at own cost ≤ 1. Attempts solve when they
 * reach the same bar — alternate winning walls accepted. Graded by the
 * multi evaluation (shortestToSide per seat), never by 2P logic.
 */
import { applyMultiMove, createMultiGame } from './game.js';
import { getMultiLegalWalls } from './walls.js';
import { shortestToSide } from './board.js';
import { chooseMultiBotAction } from './bots.js';
import type { MultiState, MultiWall, SeatSide } from './types.js';

export interface MultiPuzzle {
  puzzleId: string;
  date: string;
  prompt: string;
  players: number;
  size: number;
  turn: number;
  sides: SeatSide[];
  pawns: { r: number; c: number }[];
  walls: MultiWall[];
  wallsRemaining: number[];
  solution: MultiWall;
  needGain: number;
  solutionGain: number;
}

export interface MultiAttemptVerdict {
  solved: boolean;
  gain: number;
  need: number;
  legal: boolean;
}

export const MULTI_PUZZLE_NEED_GAIN = 3;

function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function leaderOf(state: MultiState): number {
  let best = 0;
  let bestLen = Number.POSITIVE_INFINITY;
  for (let p = 0; p < state.players; p++) {
    const side = state.sides[p];
    if (side === undefined) continue;
    const pawn = state.pawns[p];
    if (pawn === undefined) continue;
    const l = shortestToSide(state.walls, state.size, pawn, side).length;
    const v = l < 0 ? 999 : l;
    if (v < bestLen) {
      bestLen = v;
      best = p;
    }
  }
  return best;
}

function probeLeaderGain(state: MultiState, wall: MultiWall): { legal: boolean; gain: number; cost: number } {
  const me = state.turn;
  const mySide = state.sides[me];
  const myPawn = state.pawns[me];
  if (mySide === undefined || myPawn === undefined) return { legal: false, gain: 0, cost: 0 };
  const leader = leaderOf(state);
  const leadSide = state.sides[leader];
  const leadPawn = state.pawns[leader];
  if (leadSide === undefined || leadPawn === undefined) return { legal: false, gain: 0, cost: 0 };
  const leadBefore = shortestToSide(state.walls, state.size, leadPawn, leadSide).length;
  const ownBefore = shortestToSide(state.walls, state.size, myPawn, mySide).length;
  let next: MultiState;
  try {
    next = applyMultiMove(state, { type: 'wall', wall }).state;
  } catch {
    return { legal: false, gain: 0, cost: 0 };
  }
  const leadAfterPawn = next.pawns[leader];
  const ownAfterPawn = next.pawns[me];
  if (leadAfterPawn === undefined || ownAfterPawn === undefined) return { legal: false, gain: 0, cost: 0 };
  return {
    legal: true,
    gain: shortestToSide(next.walls, next.size, leadAfterPawn, leadSide).length - leadBefore,
    cost: shortestToSide(next.walls, next.size, ownAfterPawn, mySide).length - ownBefore,
  };
}

export function seededMultiPuzzle(seedString: string, puzzleId: string, promptDate: string, players = 4): MultiPuzzle {
  const seed = hashSeed(seedString);
  const size = players >= 5 ? 13 : 9;
  const wallsEach = players >= 4 ? 5 : 10;
  for (let attempt = 0; attempt < 8; attempt++) {
    const stream = (seed + attempt * 2654435761) >>> 0;
    const lineLen = 24 + (stream % 16);
    let state = createMultiGame({ players, size, wallsPerPlayer: wallsEach });
    const line: MultiState[] = [state];
    // Generous budget: generation must be time-independent (deterministic
    // per seed on any machine); it runs once per day per server.
    for (let p = 0; p < lineLen && !state.isOver; p++) {
      try {
        state = applyMultiMove(state, chooseMultiBotAction(state, { seed: stream + p * 131, budgetMs: 2000 })).state;
        line.push(state);
      } catch {
        break;
      }
    }
    const start = 6 + (stream % 8);
    for (let k = 0; k < line.length; k++) {
      const pos = line[(start + k) % line.length];
      if (pos === undefined || pos.isOver) continue;
      const me = pos.turn;
      if ((pos.wallsRemaining[me] ?? 0) <= 0) continue;
      let best: MultiWall | null = null;
      let bestGain = -999;
      for (const w of getMultiLegalWalls(pos, me)) {
        const probe = probeLeaderGain(pos, w);
        if (!probe.legal || probe.cost > 1) continue;
        if (probe.gain > bestGain) {
          bestGain = probe.gain;
          best = w;
        }
      }
      if (best !== null && bestGain >= MULTI_PUZZLE_NEED_GAIN) {
        return {
          puzzleId,
          date: promptDate,
          prompt: `4-player choke: lengthen the leader's shortest route by ${MULTI_PUZZLE_NEED_GAIN}+ steps.`,
          players,
          size: pos.size,
          turn: me,
          sides: [...pos.sides],
          pawns: pos.pawns.map((p) => ({ ...p })),
          walls: pos.walls.map((w) => ({ ...w })),
          wallsRemaining: [...pos.wallsRemaining],
          solution: { ...best },
          needGain: MULTI_PUZZLE_NEED_GAIN,
          solutionGain: bestGain,
        };
      }
    }
  }
  throw new Error(`no multi choke found for seed ${seedString}`);
}

export function multiPuzzleDaily(date: string, players = 4): MultiPuzzle {
  return seededMultiPuzzle(`${date}:${players}p`, `multi-daily-${date}-${players}p`, date, players);
}

/** Grade a submitted wall against the puzzle position. */
export function gradeMultiAttempt(puzzle: MultiPuzzle, wall: MultiWall): MultiAttemptVerdict {
  const state: MultiState = {
    size: puzzle.size,
    wallsPerPlayer: 5,
    players: puzzle.players,
    sides: [...puzzle.sides],
    turn: puzzle.turn,
    pawns: puzzle.pawns.map((p) => ({ ...p })),
    walls: puzzle.walls.map((w) => ({ ...w })),
    wallsRemaining: [...puzzle.wallsRemaining],
    winner: null,
    isOver: false,
    moveNumber: 0,
    lastAction: null,
    rulesVersion: '1.0.0-m1',
    continueAfterWin: false,
    eliminated: [],
    placement: [],
    teamOf: null,
    winningTeam: null,
    fog: false,
    chaos: false,
    siege: false,
    siegeHeadStart: 0,
  };
  const probe = probeLeaderGain(state, wall);
  if (!probe.legal) return { solved: false, gain: 0, need: puzzle.needGain, legal: false };
  return { solved: probe.gain >= puzzle.needGain, gain: probe.gain, need: puzzle.needGain, legal: true };
}
