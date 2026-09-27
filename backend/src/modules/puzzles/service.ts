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
  dailyPuzzle,
  gradeAttempt,
  todayKey,
  type DailyPuzzle,
} from '../../../../engine/typescript/dist/puzzles/index.js';
import { getMongoDb } from '../../database/mongodb/client.js';
import { PuzzleRepository } from '../../database/mongodb/repositories/extended.repositories.js';
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
}

export interface AttemptResult {
  solved: boolean;
  gain: number;
  need: number;
  legal: boolean;
  reason?: string;
  solution?: { r: number; c: number; orientation: 'h' | 'v' };
  streak: number;
  solvedToday: boolean;
}

function toView(p: DailyPuzzle): DailyPuzzleView {
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
  };
}

async function cachedDaily(date: string): Promise<DailyPuzzle> {
  const generated = dailyPuzzle(date);
  try {
    const db = await getMongoDb();
    const repo = new PuzzleRepository(db);
    const doc = await repo.upsertDaily({
      puzzleId: generated.puzzleId,
      date,
      prompt: generated.prompt,
      position: {
        size: generated.size,
        turn: generated.turn,
        pawns: generated.pawns,
        walls: generated.walls,
        wallsRemaining: generated.wallsRemaining,
      },
      solution: generated.solution,
      needGain: generated.needGain,
    });
    // The cache only proves the puzzle was issued; the deterministic
    // generator stays the source of truth for grading.
    void (doc as unknown as Record<string, unknown>)['position'];
    return generated;
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'daily puzzle cache miss (degraded)');
    return generated;
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
    return await cachedDaily(date);
  } catch {
    // Generator throws only when no choke found in budget — fall back to
    // yesterday (also deterministic), then give up loudly.
    const y = new Date(`${date}T00:00:00Z`);
    y.setUTCDate(y.getUTCDate() - 1);
    return cachedDaily(y.toISOString().slice(0, 10));
  }
}

export function publicView(p: DailyPuzzle): DailyPuzzleView {
  return toView(p);
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
  const puzzle = await getDailyPuzzle(date);
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
    streak,
    solvedToday,
  };
}
