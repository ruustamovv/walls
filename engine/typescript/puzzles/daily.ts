/**
 * Daily "find the best wall" puzzle generator.
 *
 * Deterministic per calendar date: a seeded mixed-bot line is played, then
 * positions are scanned for a side-to-move wall that lengthens the
 * opponent's shortest route by 3+ steps at own cost ≤ 1. An attempt solves
 * the puzzle when the submitted wall reaches the same bar — alternate
 * winning walls are accepted, not just the reference one.
 */
import { applyMove, createGame } from '../rules/game.js';
import { getLegalWalls } from '../rules/walls.js';
import { findShortestPath } from '../pathfinding/bfs.js';
import { botAction, getBot } from '../bots/personalities.js';
import type { GameState, PlayerIndex, Wall } from '../core/types.js';

export interface DailyPuzzle {
  puzzleId: string; // daily-YYYY-MM-DD
  date: string;
  prompt: string;
  size: number;
  turn: PlayerIndex;
  pawns: [{ r: number; c: number }, { r: number; c: number }];
  walls: Wall[];
  wallsRemaining: [number, number];
  /** Reference solution (one of possibly several winning walls). */
  solution: Wall;
  /** Minimum opponent-route gain that counts as solved. */
  needGain: number;
  /** Gain of the reference solution (for prompt flavor). */
  solutionGain: number;
}

export interface AttemptVerdict {
  solved: boolean;
  gain: number;
  need: number;
  legal: boolean;
  reason?: string;
}

/** Minimum route-lengthening that counts as a puzzle-grade wall. */
export const PUZZLE_NEED_GAIN = 3;

function hashDate(date: string): number {
  let h = 2166136261;
  for (let i = 0; i < date.length; i++) {
    h ^= date.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function probeGain(state: GameState, player: PlayerIndex, wall: Wall): { legal: boolean; gain: number; cost: number } {
  const other = (1 - player) as PlayerIndex;
  const oppBefore = findShortestPath(state, other).length;
  const ownBefore = findShortestPath(state, player).length;
  let next: GameState;
  try {
    next = applyMove(state, { type: 'wall', wall }).state;
  } catch {
    return { legal: false, gain: 0, cost: 0 };
  }
  return {
    legal: true,
    gain: findShortestPath(next, other).length - oppBefore,
    cost: findShortestPath(next, player).length - ownBefore,
  };
}

const LINE_BOTS = ['fortress', 'runner', 'architect', 'assassin', 'calculator', 'endgame'];

/**
 * Generate a choke puzzle from any seed string (pure function of the seed).
 * Throws only when no choke is found in budget; callers fall back to a
 * neighbouring seed, which is also deterministic.
 */
export function seededPuzzle(seedString: string, puzzleId: string, promptDate: string): DailyPuzzle {
  const seed = hashDate(seedString);
  for (let attempt = 0; attempt < 8; attempt++) {
    const stream = (seed + attempt * 2654435761) >>> 0;
    const botA = getBot(LINE_BOTS[stream % LINE_BOTS.length] as string);
    const botB = getBot(LINE_BOTS[(stream >>> 8) % LINE_BOTS.length] as string);
    if (botA === null || botB === null) continue;
    const lineLen = 30 + (stream % 18);
    let state = createGame({ size: 9, wallsPerPlayer: 10 });
    const line: GameState[] = [state];
    for (let p = 0; p < lineLen && !state.isOver; p++) {
      const def = state.turn === 0 ? botA : botB;
      state = applyMove(state, botAction(def, state, stream + p * 131)).state;
      line.push(state);
    }
    // Scan positions in a date-dependent rotation for variety.
    const start = 8 + (stream % 10);
    for (let k = 0; k < line.length; k++) {
      const pos = line[(start + k) % line.length];
      if (pos === undefined || pos.isOver) continue;
      const me = pos.turn;
      if (pos.wallsRemaining[me] <= 0) continue;
      let best: Wall | null = null;
      let bestGain = -999;
      for (const w of getLegalWalls(pos, me)) {
        const probe = probeGain(pos, me, w);
        if (!probe.legal || probe.cost > 1) continue;
        if (probe.gain > bestGain) {
          bestGain = probe.gain;
          best = w;
        }
      }
      if (best !== null && bestGain >= PUZZLE_NEED_GAIN) {
        return {
          puzzleId,
          date: promptDate,
          prompt: `Find a wall that lengthens the opponent's shortest route by ${PUZZLE_NEED_GAIN} or more.`,
          size: pos.size,
          turn: me,
          pawns: [{ ...pos.pawns[0] }, { ...pos.pawns[1] }],
          walls: pos.walls.map((w) => ({ ...w })),
          wallsRemaining: [...pos.wallsRemaining] as [number, number],
          solution: { ...best },
          needGain: PUZZLE_NEED_GAIN,
          solutionGain: bestGain,
        };
      }
    }
  }
  throw new Error(`no choke found for seed ${seedString}`);
}

/**
 * Generate (pure function of date) the daily puzzle.
 * Throws only when no choke is found in budget; callers fall back to the
 * previous day, which is also deterministic.
 */
export function dailyPuzzle(date: string): DailyPuzzle {
  return seededPuzzle(date, `daily-${date}`, date);
}

/** Grade a submitted wall against the puzzle position. */
export function gradeAttempt(puzzle: DailyPuzzle, wall: Wall): AttemptVerdict {
  const state: GameState = {
    size: puzzle.size,
    wallsPerPlayer: 10,
    turn: puzzle.turn,
    pawns: [{ ...puzzle.pawns[0] }, { ...puzzle.pawns[1] }],
    walls: puzzle.walls.map((w) => ({ ...w })),
    wallsRemaining: [...puzzle.wallsRemaining] as [number, number],
    winner: null,
    isOver: false,
    moveNumber: 0,
    lastAction: null,
    rulesVersion: '1.0.0',
  };
  if (state.wallsRemaining[puzzle.turn] <= 0) {
    return { solved: false, gain: 0, need: puzzle.needGain, legal: false, reason: 'no_walls_remaining' };
  }
  const probe = probeGain(state, puzzle.turn, wall);
  if (!probe.legal) {
    return { solved: false, gain: 0, need: puzzle.needGain, legal: false, reason: 'illegal_wall' };
  }
  return { solved: probe.gain >= puzzle.needGain && probe.cost <= 1, gain: probe.gain, need: puzzle.needGain, legal: true };
}

export function todayKey(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}
