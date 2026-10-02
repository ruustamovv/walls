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
  /** Curated-only: how demanding the position is. */
  difficulty?: PuzzleDifficulty;
  /** Curated-only: walls that reach the bar (1 = a single answer). */
  alternatives?: number;
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

/** Full wall scan of a position: identical best-pick semantics to the loop below. */
function scanWalls(state: GameState, player: PlayerIndex): { best: Wall | null; bestGain: number; scored: { gain: number; cost: number }[] } {
  let best: Wall | null = null;
  let bestGain = -999;
  const scored: { gain: number; cost: number }[] = [];
  for (const w of getLegalWalls(state, player)) {
    const probe = probeGain(state, player, w);
    if (!probe.legal || probe.cost > 1) continue;
    scored.push({ gain: probe.gain, cost: probe.cost });
    if (probe.gain > bestGain) {
      bestGain = probe.gain;
      best = w;
    }
  }
  return { best, bestGain, scored };
}

// ── Curated daily selection (PUZ-002) ────────────────────────────
// One seed rarely yields a memorable puzzle: most chokes have a dozen
// equivalent answers. The curator builds a small pool of engine-valid
// candidates from neighbouring seeds and keeps the most demanding one:
// high gain, a lonely best answer (uniqueGap), and a crowded mid-game
// board (tension). An optional AI "taste" only steers WHICH candidate wins —
// every candidate is already engine-graded, so the model can never invent a
// position or weaken the validation bar.

export interface PuzzleTaste {
  /** 0 = any solver accepted, 1 = demand a near-unique answer. */
  sharp: number;
  /** 0 = quiet positions fine, 1 = prefer crowded mid-game tension. */
  tense: number;
}

export const DEFAULT_TASTE: PuzzleTaste = { sharp: 0.5, tense: 0.5 };

export type PuzzleDifficulty = 'classic' | 'tricky' | 'sharp' | 'devilish';

export interface PuzzleQuality {
  solutionGain: number;
  /** Best gain minus the best DIFFERENT gain (equals gain when lonely). */
  uniqueGap: number;
  /** Walls that reach the bar (1 = there is a single answer). */
  alternatives: number;
  /** Walls on board + plies played: how deep into a fight the position is. */
  tension: number;
  difficulty: PuzzleDifficulty;
}

export function difficultyOf(gain: number, gap: number): PuzzleDifficulty {
  if (gain >= 5 && gap >= 2) return 'devilish';
  if (gain >= 4 && gap >= 1) return 'sharp';
  if (gain >= 4) return 'tricky';
  return 'classic';
}

function qualityOf(state: GameState, bestGain: number, scored: { gain: number; cost: number }[]): PuzzleQuality {
  let runnerUp = -999;
  let alternatives = 0;
  for (const s of scored) {
    if (s.gain >= PUZZLE_NEED_GAIN) alternatives++;
    if (s.gain < bestGain && s.gain > runnerUp) runnerUp = s.gain;
  }
  const uniqueGap = runnerUp <= -999 ? bestGain : bestGain - runnerUp;
  return {
    solutionGain: bestGain,
    uniqueGap,
    alternatives,
    tension: state.walls.length + state.moveNumber,
    difficulty: difficultyOf(bestGain, uniqueGap),
  };
}

const DIFFICULTY_PROMPT: Record<PuzzleDifficulty, string> = {
  classic: `Find a wall that lengthens the opponent's shortest route by ${PUZZLE_NEED_GAIN} or more. Several walls may work — any of them solves it.`,
  tricky: `Tricky daily: one wall lengthens the opponent's route by 4 or more. Look past the obvious.`,
  sharp: `Sharp daily: a single wall stands out — it gains clearly more than any alternative. Find it.`,
  devilish: `Devilish daily: the answer gains 5+ and nothing else comes close. Study the whole corridor.`,
};

/** Build a pool of engine-valid candidates from neighbouring seeds. */
export function seededPuzzlePool(seedBase: string, puzzleId: string, promptDate: string, count = 6): { puzzle: DailyPuzzle; quality: PuzzleQuality }[] {
  const out: { puzzle: DailyPuzzle; quality: PuzzleQuality }[] = [];
  for (let i = 0; i < count; i++) {
    try {
      const puzzle = seededPuzzle(`${seedBase}#${i}`, puzzleId, promptDate);
      // Re-scan to grade uniqueness (same scan the generator used).
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
      const { scored } = scanWalls(state, puzzle.turn);
      // Approximate tension from the wall count (moveNumber is line-local).
      const quality = qualityOf(
        { ...state, moveNumber: puzzle.walls.length },
        puzzle.solutionGain,
        scored,
      );
      out.push({ puzzle, quality });
    } catch {
      // Seed yielded no choke — the pool simply skips it.
    }
  }
  return out;
}

function clampTaste(t: PuzzleTaste): PuzzleTaste {
  const c = (v: number): number => Math.max(0, Math.min(1, v));
  return { sharp: c(t.sharp), tense: c(t.tense) };
}

/** Pick the most demanding candidate. Pure function of (pool, taste). */
export function selectPuzzle(pool: { puzzle: DailyPuzzle; quality: PuzzleQuality }[], taste: PuzzleTaste): DailyPuzzle {
  if (pool.length === 0) throw new Error('selectPuzzle: empty pool');
  const t = clampTaste(taste);
  let best = pool[0] as { puzzle: DailyPuzzle; quality: PuzzleQuality };
  let bestScore = -Infinity;
  for (const entry of pool) {
    const q = entry.quality;
    const score = q.solutionGain * (1 + t.sharp) + q.uniqueGap * (1 + 2 * t.sharp) + q.tension * 0.1 * (0.5 + t.tense);
    if (score > bestScore) {
      bestScore = score;
      best = entry;
    }
  }
  return {
    ...best.puzzle,
    prompt: DIFFICULTY_PROMPT[best.quality.difficulty],
    difficulty: best.quality.difficulty,
    alternatives: best.quality.alternatives,
  };
}

/**
 * The curated daily: hardest-of-pool under the given taste.
 * Falls back to the classic single-seed puzzle when the pool is empty.
 */
export function curatedDaily(date: string, taste: PuzzleTaste = DEFAULT_TASTE, poolSize = 6): DailyPuzzle {
  const pool = seededPuzzlePool(date, `daily-${date}`, date, poolSize);
  if (pool.length === 0) return dailyPuzzle(date);
  return selectPuzzle(pool, taste);
}

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
      // Capped line budget: generation must stay fast on the request path;
      // the options are fixed, so the line stays deterministic per seed.
      state = applyMove(state, botAction(def, state, stream + p * 131, { hardCapMs: 40 })).state;
      line.push(state);
    }
    // Scan positions in a date-dependent rotation for variety.
    const start = 8 + (stream % 10);
    for (let k = 0; k < line.length; k++) {
      const pos = line[(start + k) % line.length];
      if (pos === undefined || pos.isOver) continue;
      const me = pos.turn;
      if (pos.wallsRemaining[me] <= 0) continue;
      const { best, bestGain } = scanWalls(pos, me);
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
