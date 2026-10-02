/**
 * Daily puzzle service: deterministic engine generation + Mongo caching +
 * attempt grading + streaks.
 *
 * The puzzle is a pure function of the calendar date (same for every user,
 * fair competition). Mongo caches the generated position so concurrent
 * requests share one document; if Mongo is down the puzzle is still served
 * from the engine (attempts simply aren't recorded — degraded, honest).
 */
import {
  curatedDaily,
  dailyPuzzle,
  gradeAttempt,
  seededPuzzlePool,
  selectPuzzle,
  todayKey,
  DEFAULT_TASTE,
  type DailyPuzzle,
  type PuzzleDifficulty,
  type PuzzleTaste,
} from '../../../../engine/typescript/dist/puzzles/index.js';
import { getMongoDb } from '../../database/mongodb/client.js';
import { PuzzleRepository } from '../../database/mongodb/repositories/extended.repositories.js';
import type { PuzzleDoc } from '../../database/mongodb/types.js';
import { logger } from '../../common/logging/logger.js';

export interface DailyPuzzleView {
  puzzleId: string;
  date: string;
  prompt: string;
  size: number;
  turn: 0 | 1;
  pawns: [{ r: number; c: number }, { r: number; c: number }];
  walls: { r: number; c: number; orientation: 'h' | 'v' }[];
  wallsRemaining: [number, number];
  needGain: number;
  /** Daily-only: how demanding the position is (absent for personal puzzles). */
  difficulty?: PuzzleDifficulty;
  /** Daily-only: walls that reach the bar (1 = a single answer exists). */
  alternatives?: number;
  /** Daily-only: 'ai' when today's taste came from the model. */
  tasteSource?: 'ai' | 'default';
}

export interface AttemptResult {
  solved: boolean;
  gain: number;
  need: number;
  legal: boolean;
  reason?: string;
  solution?: { r: number; c: number; orientation: 'h' | 'v' };
  /** Reference answer's gain — the target to beat (absent for legacy docs). */
  solutionGain?: number;
  streak: number;
  solvedToday: boolean;
}

function toView(p: DailyPuzzle, tasteSource: 'ai' | 'default'): DailyPuzzleView {
  return {
    puzzleId: p.puzzleId,
    date: p.date,
    prompt: p.prompt,
    size: p.size,
    turn: p.turn,
    pawns: p.pawns,
    walls: p.walls,
    wallsRemaining: p.wallsRemaining,
    needGain: p.needGain,
    difficulty: p.difficulty ?? 'classic',
    alternatives: p.alternatives ?? 1,
    tasteSource,
  };
}

/** Rebuild a puzzle from its cached document — no regeneration cost. */
function docToPuzzle(doc: PuzzleDoc): DailyPuzzle | null {
  const pos = doc.position as {
    size?: number; turn?: number; pawns?: [{ r: number; c: number }, { r: number; c: number }];
    walls?: { r: number; c: number; orientation: 'h' | 'v' }[]; wallsRemaining?: [number, number];
  } | undefined;
  const sol = doc.solution as { r: number; c: number; orientation: 'h' | 'v' } | undefined;
  if (doc.puzzleId === undefined || doc.date === undefined || doc.prompt === undefined) return null;
  if (pos?.size === undefined || pos.turn === undefined || pos.pawns === undefined) return null;
  if (pos.walls === undefined || pos.wallsRemaining === undefined || sol === undefined) return null;
  if (typeof doc.needGain !== 'number') return null;
  return {
    puzzleId: doc.puzzleId,
    date: doc.date,
    prompt: doc.prompt,
    size: pos.size,
    turn: pos.turn as 0 | 1,
    pawns: pos.pawns,
    walls: pos.walls,
    wallsRemaining: pos.wallsRemaining,
    solution: sol,
    needGain: doc.needGain,
    solutionGain: typeof doc.solutionGain === 'number' ? doc.solutionGain : doc.needGain,
    ...(typeof doc.difficulty === 'string' ? { difficulty: doc.difficulty as PuzzleDifficulty } : {}),
    ...(typeof doc.alternatives === 'number' ? { alternatives: doc.alternatives } : {}),
  };
}

/**
 * Today's AI taste (PUZ-003). Order: cached document → configured model →
 * deterministic default. The model only picks {sharp, tense} weights over
 * engine-graded candidates; one call per day at most (then cached in the doc).
 */
async function tasteFor(
  date: string,
  pool: { puzzle: DailyPuzzle; quality: { solutionGain: number; uniqueGap: number; tension: number } }[],
): Promise<{ taste: PuzzleTaste; source: 'ai' | 'default' }> {
  if (pool.length === 0) return { taste: DEFAULT_TASTE, source: 'default' };
  const { activeProvider } = await import('../ai/provider.js');
  const provider = activeProvider();
  if (provider === null) return { taste: DEFAULT_TASTE, source: 'default' };
  try {
    const { proposePuzzleTaste } = await import('../ai/complete.js');
    const res = await proposePuzzleTaste(`daily-puzzle:${date}`, provider.id, {
      date,
      candidates: pool.map((e) => ({ gain: e.quality.solutionGain, gap: e.quality.uniqueGap, tension: e.quality.tension })),
    });
    if (!res.ok) return { taste: DEFAULT_TASTE, source: 'default' };
    return { taste: res.taste, source: 'ai' };
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'puzzle taste fell back to default');
    return { taste: DEFAULT_TASTE, source: 'default' };
  }
}

async function cachedDaily(date: string): Promise<{ puzzle: DailyPuzzle; tasteSource: 'ai' | 'default' }> {
  const puzzleId = `daily-${date}`;
  const generated = (): DailyPuzzle => curatedDaily(date);
  try {
    const db = await getMongoDb();
    const repo = new PuzzleRepository(db);
    // Fast path: today's document already fixes the puzzle for everyone.
    const existing = await repo.findByPuzzleId(puzzleId);
    if (existing !== null) {
      const rebuilt = docToPuzzle(existing);
      if (rebuilt !== null) {
        return { puzzle: rebuilt, tasteSource: existing.tasteSource === 'ai' ? 'ai' : 'default' };
      }
    }
    // Slow path (once per day): grade a pool, let the AI steer selection.
    const pool = seededPuzzlePool(date, puzzleId, date, 4);
    const { taste, source } = await tasteFor(date, pool);
    const puzzle = pool.length === 0 ? dailyPuzzle(date) : selectPuzzle(pool, taste);
    try {
      const input: Parameters<PuzzleRepository['upsertDaily']>[0] = {
        puzzleId: puzzle.puzzleId,
        date,
        prompt: puzzle.prompt,
        position: {
          size: puzzle.size,
          turn: puzzle.turn,
          pawns: puzzle.pawns,
          walls: puzzle.walls,
          wallsRemaining: puzzle.wallsRemaining,
        },
        solution: puzzle.solution,
        needGain: puzzle.needGain,
        solutionGain: puzzle.solutionGain,
        taste,
        tasteSource: source,
      };
      if (puzzle.difficulty !== undefined) input.difficulty = puzzle.difficulty;
      if (puzzle.alternatives !== undefined) input.alternatives = puzzle.alternatives;
      await repo.upsertDaily(input);
    } catch (err) {
      logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'daily puzzle cache miss (degraded)');
    }
    return { puzzle, tasteSource: source };
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'daily puzzle cache miss (degraded)');
    return { puzzle: generated(), tasteSource: 'default' };
  }
}

/** Consecutive solved days ending today or yesterday. */
export function streakFrom(datesDesc: string[], today: string): number {
  const set = new Set(datesDesc);
  let streak = 0;
  let cursor = today;
  if (!set.has(cursor)) {
    // Allow "yesterday" as the streak anchor (today not solved yet).
    const y = new Date(`${cursor}T00:00:00Z`);
    y.setUTCDate(y.getUTCDate() - 1);
    cursor = y.toISOString().slice(0, 10);
    if (!set.has(cursor)) return 0;
  }
  for (;;) {
    if (!set.has(cursor)) break;
    streak++;
    const d = new Date(`${cursor}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 1);
    cursor = d.toISOString().slice(0, 10);
  }
  return streak;
}

export async function getDailyPuzzle(date: string = todayKey()): Promise<DailyPuzzle> {
  try {
    return (await cachedDaily(date)).puzzle;
  } catch {
    // Generator throws only when no choke found in budget — fall back to
    // yesterday (also deterministic), then give up loudly.
    const y = new Date(`${date}T00:00:00Z`);
    y.setUTCDate(y.getUTCDate() - 1);
    return (await cachedDaily(y.toISOString().slice(0, 10))).puzzle;
  }
}

export function publicView(p: DailyPuzzle, tasteSource: 'ai' | 'default' = 'default'): DailyPuzzleView {
  return toView(p, tasteSource);
}

/** Puzzle plus the taste provenance for the public route. */
export async function getDailyPuzzleView(date: string = todayKey()): Promise<{ puzzle: DailyPuzzle; tasteSource: 'ai' | 'default' }> {
  try {
    return await cachedDaily(date);
  } catch {
    const y = new Date(`${date}T00:00:00Z`);
    y.setUTCDate(y.getUTCDate() - 1);
    return cachedDaily(y.toISOString().slice(0, 10));
  }
}

// ── Personal mistake puzzles ─────────────────────────────

export interface PersonalPuzzle {
  puzzleId: string;
  gameId: string;
  seq: number;
  seat: 0 | 1;
  labels: string[];
  played: string;
  best: string;
  position: DailyPuzzleView & { wallsPerPlayer: number };
  solved: boolean;
}

const MINE_LABELS = new Set(['WALL_BLUNDER', 'PATH_BLUNDER', 'MISSED_CHOKE']);

async function replayActions(gameId: string): Promise<{
  actions: { type: 'move'; to: { r: number; c: number } }[] | { type: 'wall'; wall: { r: number; c: number; orientation: 'h' | 'v' } }[];
  size: number;
  wallsPerPlayer: number;
} | null> {
  try {
    const db = await getMongoDb();
    const { ReplayRepository } = await import('../../database/mongodb/repositories/replay.repository.js');
    const replay = await new ReplayRepository(db).findByGame(gameId);
    if (replay === null || replay.actions.length === 0) return null;
    const initial = replay.initialState as { size?: number; wallsPerPlayer?: number };
    return {
      actions: replay.actions as { type: 'move'; to: { r: number; c: number } }[] | { type: 'wall'; wall: { r: number; c: number; orientation: 'h' | 'v' } }[],
      size: initial.size ?? 9,
      wallsPerPlayer: initial.wallsPerPlayer ?? 10,
    };
  } catch {
    return null;
  }
}

/** Up to 3 recent blunder positions from the user's own finished games. */
export async function myMistakes(userId: string): Promise<PersonalPuzzle[]> {
  const [{ GameRepository }, rev, rules, { COLLECTIONS }] = await Promise.all([
    import('../../database/mongodb/repositories/game.repository.js'),
    import('../../../../engine/typescript/dist/review/index.js'),
    import('../../../../engine/typescript/dist/rules/game.js'),
    import('../../database/mongodb/collections.js'),
  ]);
  const out: PersonalPuzzle[] = [];
  try {
    const db = await getMongoDb();
    const games = await new GameRepository(db).listByUser(userId, 5);
    for (const g of games) {
      if (out.length >= 3) break;
      if (g.status !== 'FINISHED') continue;
      const engineId = g.engineId ?? g._id;
      const rep = await replayActions(engineId);
      if (rep === null) continue;
      const seat = (g.players.find((p) => p.userId === userId)?.seat ?? 0) as 0 | 1;
      const review = rev.reviewGame(
        { size: rep.size, wallsPerPlayer: rep.wallsPerPlayer },
        rep.actions,
        7,
        { wallCandidates: 8, budgetMs: 15 },
      );
      const bad = review.moves.find((m) => m.by === seat && m.labels.some((l) => MINE_LABELS.has(l)));
      if (bad === undefined) continue;
      const pos = rules.replayGame({ size: rep.size, wallsPerPlayer: rep.wallsPerPlayer }, rep.actions.slice(0, bad.seq)).state;
      const puzzleId = `mine-${engineId}-${bad.seq}`;
      const attempts = await db.collection(COLLECTIONS.puzzle_attempts).find({ userId, puzzleId, solved: true }).limit(1).toArray().catch(() => []);
      out.push({
        puzzleId,
        gameId: engineId,
        seq: bad.seq,
        seat,
        labels: [...bad.labels],
        played: bad.action.type === 'move' ? `move ${bad.action.to.r},${bad.action.to.c}` : `wall ${bad.action.wall.orientation} ${bad.action.wall.r},${bad.action.wall.c}`,
        best: bad.best,
        position: {
          puzzleId,
          date: '',
          prompt: `You played ${bad.action.type === 'move' ? 'a move' : 'a wall'} here — find the stronger continuation.`,
          size: pos.size,
          turn: pos.turn,
          pawns: [{ ...pos.pawns[0] }, { ...pos.pawns[1] }],
          walls: pos.walls.map((w) => ({ ...w })),
          wallsRemaining: [...pos.wallsRemaining] as [number, number],
          wallsPerPlayer: rep.wallsPerPlayer,
          needGain: 0,
        },
        solved: attempts.length > 0,
      });
    }
  } catch {
    return out;
  }
  return out;
}

/** Parse a describeAction() string back into an action. */
function parseBest(best: string): { type: 'move'; to: { r: number; c: number } } | { type: 'wall'; wall: { r: number; c: number; orientation: 'h' | 'v' } } | null {
  const move = /^move (\d+),(\d+)$/.exec(best);
  if (move !== null) return { type: 'move', to: { r: Number(move[1]), c: Number(move[2]) } };
  const wall = /^wall ([hv]) (\d+),(\d+)$/.exec(best);
  if (wall !== null) {
    return { type: 'wall', wall: { orientation: wall[1] as 'h' | 'v', r: Number(wall[2]), c: Number(wall[3]) } };
  }
  return null;
}

/** Grade a personal-puzzle attempt against the reference best outcome. */
export async function attemptMine(
  userId: string,
  gameId: string,
  seq: number,
  action: { type: 'move'; to: { r: number; c: number } } | { type: 'wall'; wall: { r: number; c: number; orientation: 'h' | 'v' } },
): Promise<{ solved: boolean; best: string; played: string }> {
  const rep = await replayActions(gameId);
  if (rep === null || seq < 0 || seq >= rep.actions.length) throw new Error('puzzle not found');
  const rules = await import('../../../../engine/typescript/dist/rules/game.js');
  const rev = await import('../../../../engine/typescript/dist/review/index.js');
  const bfs = await import('../../../../engine/typescript/dist/pathfinding/bfs.js');
  const review = rev.reviewGame(
    { size: rep.size, wallsPerPlayer: rep.wallsPerPlayer },
    rep.actions,
    7,
    { wallCandidates: 8, budgetMs: 15 },
  );
  const target = review.moves.find((m) => m.seq === seq);
  if (target === undefined) throw new Error('puzzle not found');
  const pos = rules.replayGame({ size: rep.size, wallsPerPlayer: rep.wallsPerPlayer }, rep.actions.slice(0, seq)).state;
  const me = pos.turn;
  const other = (1 - me) as 0 | 1;
  const len = (s: typeof pos, p: 0 | 1): number => {
    const l = bfs.findShortestPath(s, p).length;
    return l < 0 ? 999 : l;
  };
  // Reference outcome: apply the review's best action to the same position.
  const refAction = parseBest(target.best);
  if (refAction === null) throw new Error('puzzle not found');
  let refState;
  try {
    refState = rules.applyMove(pos, refAction).state;
  } catch {
    throw new Error('puzzle not found');
  }
  const bestOwn = len(refState, me);
  const bestOpp = len(refState, other);
  let submitted;
  try {
    submitted = rules.applyMove(pos, action).state;
  } catch {
    return { solved: false, best: target.best, played: 'illegal' };
  }
  // Solved when the submitted action matches the reference outcome band:
  // own route no worse than best, opponent route within 1 step of best
  // (alternate winning lines accepted).
  const solved = len(submitted, me) <= bestOwn && len(submitted, other) >= bestOpp - 1;
  try {
    const db = await getMongoDb();
    const { PuzzleRepository } = await import('../../database/mongodb/repositories/extended.repositories.js');
    await new PuzzleRepository(db).recordAttempt(userId, `mine-${gameId}-${seq}`, solved);
  } catch {
    // attempts are advisory
  }
  return { solved, best: target.best, played: describePlayed(action) };
}

function describePlayed(action: { type: 'move'; to: { r: number; c: number } } | { type: 'wall'; wall: { r: number; c: number; orientation: 'h' | 'v' } }): string {
  return action.type === 'move' ? `move ${action.to.r},${action.to.c}` : `wall ${action.wall.orientation} ${action.wall.r},${action.wall.c}`;
}

export async function userStreak(userId: string, today: string = todayKey()): Promise<{ streak: number; solvedToday: boolean }> {
  try {
    const db = await getMongoDb();
    const dates = await new PuzzleRepository(db).solvedDates(userId);
    return { streak: streakFrom(dates, today), solvedToday: dates[0] === today };
  } catch {
    return { streak: 0, solvedToday: false };
  }
}

export async function attemptDaily(
  userId: string,
  wall: { r: number; c: number; orientation: 'h' | 'v' },
  date: string = todayKey(),
): Promise<AttemptResult> {
  const { puzzle } = await cachedDaily(date);
  const verdict = gradeAttempt(puzzle, wall);
  try {
    const db = await getMongoDb();
    const repo = new PuzzleRepository(db);
    await repo.recordAttempt(userId, puzzle.puzzleId, verdict.solved);
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'puzzle attempt not recorded (degraded)');
  }
  const { streak, solvedToday } = await userStreak(userId, date);
  return {
    solved: verdict.solved,
    gain: verdict.gain,
    need: verdict.need,
    legal: verdict.legal,
    ...(verdict.reason !== undefined ? { reason: verdict.reason } : {}),
    ...(verdict.solved ? { solution: { ...puzzle.solution } } : {}),
    solutionGain: puzzle.solutionGain,
    streak,
    solvedToday,
  };
}
