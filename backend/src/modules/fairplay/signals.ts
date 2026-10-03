/**
 * Anti-cheat signals (FRP-002) — ADVISORY ONLY, never auto-ban.
 *
 * Each detector is a pure function over precomputed facts (move timestamps,
 * finished-game docs, rating history). When a pattern crosses its threshold a
 * moderation_cases document is written with a full evidence bundle; humans
 * review and decide. No signal ever suspends, bans, or mutates ratings.
 *
 * Detectors:
 *  - rapid-move-streak: ≥3 consecutive moves each <500ms apart in one game
 *    (bot-like tempo; humans rarely sustain sub-500ms decisions).
 *  - same-pair-ranked-wins: ≥3 consecutive ranked wins against the SAME
 *    opponent (farming / win-trading shape).
 *  - loss-streak-sandbagging: ≥5 consecutive ranked losses in rating history
 *    (deliberate rating dump before a climb).
 *  - engine-correlation: review accuracy ≥97 with ≥85% top-engine matches
 *    over 30+ moves (plays like the reference search itself; strong humans
 *    sit well below both bars — calibration, not vibes).
 */
import type { Db } from 'mongodb';
import { COLLECTIONS } from '../../database/mongodb/collections.js';
import { withDomainId } from '../../database/mongodb/ids.js';
import type { GameDoc, RatingHistoryDoc } from '../../database/mongodb/types.js';

export type SignalKind = 'rapid-move-streak' | 'same-pair-ranked-wins' | 'loss-streak-sandbagging' | 'engine-correlation';

export interface SignalHit {
  kind: SignalKind;
  /** One-line human summary for the queue. */
  summary: string;
  /** Structured evidence bundle stored on the case doc. */
  evidence: Record<string, unknown>;
}

export const RAPID_MOVE_THRESHOLD_MS = 500;
export const RAPID_MOVE_STREAK_MIN = 3;
export const SAME_PAIR_WINS_MIN = 3;
export const SANDBAG_LOSS_STREAK_MIN = 5;
/** Engine-correlation bars (set from bot-vs-human calibration, not vibes). */
export const ENGINE_CORR_MIN_MOVES = 30;
export const ENGINE_CORR_MIN_ACCURACY = 97;
export const ENGINE_CORR_MIN_BEST_RATE = 0.85;

/**
 * Longest run of consecutive moves each faster than the threshold.
 * Returns the hit when the run reaches RAPID_MOVE_STREAK_MIN.
 */
export function detectRapidMoveStreak(moveTimes: number[], thresholdMs = RAPID_MOVE_THRESHOLD_MS): SignalHit | null {
  const times = [...moveTimes].sort((a, b) => a - b);
  let bestRun = 0;
  let runStart = 0;
  let bestStart = 0;
  for (let i = 1; i < times.length; i++) {
    if (times[i]! - times[i - 1]! < thresholdMs) {
      const run = i - runStart + 1;
      if (run > bestRun) {
        bestRun = run;
        bestStart = runStart;
      }
    } else {
      runStart = i;
    }
  }
  if (bestRun < RAPID_MOVE_STREAK_MIN) return null;
  const streak = times.slice(bestStart, bestStart + bestRun);
  const gaps = streak.slice(1).map((t, i) => t - streak[i]!);
  const avgGap = gaps.reduce((a, b) => a + b, 0) / Math.max(1, gaps.length);
  return {
    kind: 'rapid-move-streak',
    summary: `${bestRun} consecutive moves under ${thresholdMs}ms (avg ${Math.round(avgGap)}ms)`,
    evidence: {
      streakMoves: bestRun,
      thresholdMs,
      avgGapMs: Math.round(avgGap),
      firstAt: streak[0],
      lastAt: streak[streak.length - 1],
    },
  };
}

/**
 * Consecutive ranked wins against the same opponent, scanning the user's
 * newest-first finished game docs. Casual/unrated games never count.
 */
export function detectSamePairWins(games: GameDoc[], userId: string): SignalHit | null {
  let streak = 0;
  let pairId = '';
  let firstGameId = '';
  for (const g of games) {
    if (g.mode !== 'ranked' || g.status !== 'FINISHED' || g.result === undefined) continue;
    const seat = g.players.findIndex((p) => p.userId === userId);
    if (seat === -1) continue;
    const won = g.result.winnerSeat === seat;
    const opponent = g.players.find((p) => p.seat !== seat);
    if (!won || opponent === undefined) {
      streak = 0;
      pairId = '';
      continue;
    }
    if (pairId === opponent.userId) {
      streak += 1;
    } else {
      pairId = opponent.userId;
      streak = 1;
      firstGameId = g.engineId ?? g._id;
    }
    if (streak >= SAME_PAIR_WINS_MIN) {
      return {
        kind: 'same-pair-ranked-wins',
        summary: `${streak} consecutive ranked wins vs the same opponent`,
        evidence: {
          streak,
          opponentUserId: pairId,
          firstGameId,
          gameId: g.engineId ?? g._id,
        },
      };
    }
  }
  return null;
}

/**
 * Consecutive ranked losses in rating history (newest-first docs). A long
 * loss dump followed by a climb is the sandbagging shape; the streak alone
 * is only a signal — staff decide.
 */
export function detectSandbagging(history: RatingHistoryDoc[]): SignalHit | null {
  let streak = 0;
  let first: RatingHistoryDoc | null = null;
  let ratingDrop = 0;
  for (const row of history) {
    if (row.after >= row.before) {
      streak = 0;
      first = null;
      continue;
    }
    if (streak === 0) first = row;
    streak += 1;
    ratingDrop = (first?.before ?? row.before) - row.after;
    if (streak >= SANDBAG_LOSS_STREAK_MIN) {
      return {
        kind: 'loss-streak-sandbagging',
        summary: `${streak} consecutive ranked losses (${ratingDrop} points dropped)`,
        evidence: {
          streak,
          ratingDrop,
          firstGameId: first?.gameId ?? null,
          lastGameId: row.gameId ?? null,
        },
      };
    }
  }
  return null;
}

/**
 * Pure engine-correlation check over one side's review numbers.
 * Both bars must clear together: elite humans can spike accuracy in short
 * quiet games, but sustained top-engine matching over 30+ moves is the
 * reference search's own fingerprint.
 */
export function detectEngineCorrelation(input: { accuracy: number; bestRate: number; moves: number }): SignalHit | null {
  if (input.moves < ENGINE_CORR_MIN_MOVES) return null;
  if (input.accuracy < ENGINE_CORR_MIN_ACCURACY || input.bestRate < ENGINE_CORR_MIN_BEST_RATE) return null;
  return {
    kind: 'engine-correlation',
    summary: `review accuracy ${input.accuracy} with ${(input.bestRate * 100).toFixed(1)}% top-engine matches over ${input.moves} moves`,
    evidence: {
      accuracy: input.accuracy,
      bestRate: Math.round(input.bestRate * 1000) / 1000,
      moves: input.moves,
      minAccuracy: ENGINE_CORR_MIN_ACCURACY,
      minBestRate: ENGINE_CORR_MIN_BEST_RATE,
      minMoves: ENGINE_CORR_MIN_MOVES,
    },
  };
}

/** One deep review runs at a time — sweeps skip (never queue) when busy. */
let corrReviewRunning = false;

/**
 * Grade both seats of a finished game against the reference search.
 * Capped hard (few candidates, tiny budget, first 48 plies): this runs in a
 * fire-and-forget sweep, so it must stay a seconds-scale background job.
 * Returns per-seat {accuracy, bestRate, moves} for the pure detector above.
 */
export async function reviewCorrelation(
  size: number,
  wallsPerPlayer: number,
  actions: readonly import('../../../../engine/typescript/dist/core/types.js').Action[],
  gameId: string,
): Promise<[{ accuracy: number; bestRate: number; moves: number }, { accuracy: number; bestRate: number; moves: number }] | null> {
  // gameId is carried for the evidence bundle the caller writes.
  void gameId;
  if (process.env['ANTICHEAT_CORR_REVIEW'] === '0') return null;
  if (corrReviewRunning) return null;
  if (actions.length < ENGINE_CORR_MIN_MOVES) return null;
  corrReviewRunning = true;
  try {
    const rev = await import('../../../../engine/typescript/dist/review/index.js');
    const review = rev.reviewGame(
      { size, wallsPerPlayer },
      actions.slice(0, 48),
      7,
      { wallCandidates: 4, budgetMs: 5 },
    );
    const acc = review.summary.accuracy as [number, number];
    const per: [{ accuracy: number; bestRate: number; moves: number }, { accuracy: number; bestRate: number; moves: number }] = [
      { accuracy: acc[0], bestRate: 0, moves: 0 },
      { accuracy: acc[1], bestRate: 0, moves: 0 },
    ];
    for (const m of review.moves) {
      const seat = m.by as 0 | 1;
      per[seat].moves++;
      if (rev.describeAction(m.action) === m.best) per[seat].bestRate++;
    }
    for (const s of per) s.bestRate = s.moves > 0 ? s.bestRate / s.moves : 0;
    return per;
  } catch {
    return null;
  } finally {
    corrReviewRunning = false;
  }
}

export type ModerationCaseStatus = 'OPEN' | 'RESOLVED' | 'DISMISSED';

export interface ModerationCaseDoc {
  _id: string;
  userId: string;
  kind: SignalKind;
  summary: string;
  evidence: Record<string, unknown>;
  status: ModerationCaseStatus;
  resolution?: string;
  createdAt: Date;
}

export class ModerationCaseRepository {
  constructor(private readonly db: Db) {}

  async open(input: { userId: string; kind: SignalKind; summary: string; evidence: Record<string, unknown> }): Promise<ModerationCaseDoc> {
    // One open case per (user, kind): repeated signals bump the evidence
    // count instead of flooding the queue.
    const existing = await this.db.collection(COLLECTIONS.moderation_cases).findOne({
      userId: input.userId, kind: input.kind, status: 'OPEN',
    });
    if (existing !== null) {
      const ev = existing['evidence'] as Record<string, unknown>;
      const count = typeof ev['repeatCount'] === 'number' ? (ev['repeatCount'] as number) : 1;
      const res = await this.db.collection(COLLECTIONS.moderation_cases).findOneAndUpdate(
        { _id: existing['_id'] },
        { $set: { summary: input.summary, evidence: { ...ev, ...input.evidence, repeatCount: count + 1 } } },
        { returnDocument: 'after' },
      );
      if (res === null) throw new Error('moderation case update failed');
      return withDomainId<ModerationCaseDoc>(res as Record<string, unknown>);
    }
    const res = await this.db.collection(COLLECTIONS.moderation_cases).insertOne({
      userId: input.userId,
      kind: input.kind,
      summary: input.summary,
      evidence: { ...input.evidence, repeatCount: 1 },
      status: 'OPEN',
      createdAt: new Date(),
    });
    const raw = await this.db.collection(COLLECTIONS.moderation_cases).findOne({ _id: res.insertedId });
    if (raw === null) throw new Error('moderation case insert failed');
    return withDomainId<ModerationCaseDoc>(raw as Record<string, unknown>);
  }

  async list(status: ModerationCaseStatus | 'ALL', limit = 50): Promise<ModerationCaseDoc[]> {
    const filter = status === 'ALL' ? {} : { status };
    const rows = await this.db.collection(COLLECTIONS.moderation_cases)
      .find(filter).sort({ createdAt: -1 }).limit(Math.min(Math.max(limit, 1), 200)).toArray();
    return rows.map((r) => withDomainId<ModerationCaseDoc>(r as Record<string, unknown>));
  }

  async resolve(id: string, status: Exclude<ModerationCaseStatus, 'OPEN'>, resolution: string): Promise<boolean> {
    const { tryToObjectId } = await import('../../database/mongodb/ids.js');
    const oid = tryToObjectId(id);
    if (oid === null) return false;
    const res = await this.db.collection(COLLECTIONS.moderation_cases).updateOne(
      { _id: oid, status: 'OPEN' },
      { $set: { status, resolution: resolution.slice(0, 500) } },
    );
    return res.modifiedCount === 1;
  }
}

/**
 * Run every detector over a just-finished ranked 1v1 and open cases for
 * any hits. Best-effort: signal detection must never break settlement.
 */
export async function runSignalSweep(
  db: Db,
  input: {
    gameId: string;
    winnerId: string;
    loserId: string;
    moveTimes: number[];
    mode: string;
    ratingMode: string;
    /** Full action list for the engine-correlation review (ranked only). */
    actions?: readonly import('../../../../engine/typescript/dist/core/types.js').Action[];
    size?: number;
    wallsPerPlayer?: number;
    /** userId per seat ([seat0, seat1]) so correlation hits attribute correctly. */
    seatIds?: [string, string];
  },
): Promise<SignalHit[]> {
  const hits: SignalHit[] = [];
  const cases = new ModerationCaseRepository(db);
  const timing = detectRapidMoveStreak(input.moveTimes);
  if (timing !== null) {
    hits.push(timing);
    await cases.open({ userId: input.winnerId, kind: timing.kind, summary: timing.summary, evidence: { ...timing.evidence, gameId: input.gameId } }).catch(() => undefined);
    await cases.open({ userId: input.loserId, kind: timing.kind, summary: timing.summary, evidence: { ...timing.evidence, gameId: input.gameId } }).catch(() => undefined);
  }
  if (input.mode !== 'ranked') return hits;
  // Engine-correlation: grade both seats against the reference search.
  // Skips silently when actions are absent, short, or a review is running.
  if (input.actions !== undefined && input.size !== undefined && input.wallsPerPlayer !== undefined && input.seatIds !== undefined) {
    try {
      const per = await reviewCorrelation(input.size, input.wallsPerPlayer, input.actions, input.gameId);
      if (per !== null) {
        for (const seat of [0, 1] as const) {
          const hit = detectEngineCorrelation(per[seat]);
          if (hit !== null) {
            hits.push(hit);
            await cases.open({
              userId: input.seatIds[seat],
              kind: hit.kind,
              summary: `seat ${seat}: ${hit.summary}`,
              evidence: { ...hit.evidence, gameId: input.gameId, seat },
            }).catch(() => undefined);
          }
        }
      }
    } catch {
      // correlation is advisory; the other detectors already ran
    }
  }
  const { GameRepository } = await import('../../database/mongodb/repositories/game.repository.js');
  const { RatingRepository } = await import('../../database/mongodb/repositories/rating.repository.js');
  const games = new GameRepository(db);
  const ratings = new RatingRepository(db);
  for (const uid of [input.winnerId, input.loserId]) {
    const recent = await games.listByUser(uid, 20).catch(() => [] as GameDoc[]);
    const pairHit = detectSamePairWins(recent, uid);
    if (pairHit !== null) {
      hits.push(pairHit);
      await cases.open({ userId: uid, kind: pairHit.kind, summary: pairHit.summary, evidence: { ...pairHit.evidence, gameId: input.gameId } }).catch(() => undefined);
    }
    const history = await ratings.history(uid, input.ratingMode, 50).catch(() => [] as RatingHistoryDoc[]);
    const sandHit = detectSandbagging(history);
    if (sandHit !== null) {
      hits.push(sandHit);
      await cases.open({ userId: uid, kind: sandHit.kind, summary: sandHit.summary, evidence: { ...sandHit.evidence, gameId: input.gameId } }).catch(() => undefined);
    }
  }
  return hits;
}
