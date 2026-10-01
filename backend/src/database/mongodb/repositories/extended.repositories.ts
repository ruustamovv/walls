/**
 * TournamentRepository + NotificationRepository + PuzzleRepository —
 * domain-oriented persistence for social/competitive features.
 * Each method maps to a single collection; no cross-collection joins here.
 *
 * ID rule: Mongo `ObjectId` never leaves this module — every returned
 * document carries a string `_id` via `withDomainId` (see ../ids.js).
 */
import type { Db } from 'mongodb';
import { COLLECTIONS } from '../collections.js';
import { tryToObjectId, withDomainId } from '../ids.js';
import type { NotificationDoc, PuzzleDoc, TournamentDoc } from '../types.js';

export class TournamentRepository {
  constructor(private readonly db: Db) {}

  async create(input: {
    title: string; mode?: string; timeControl?: string; startAt?: Date; endAt?: Date;
    format?: TournamentDoc['format']; rounds?: number; playersCap?: number; ownerId?: string;
    recurrence?: 'none' | 'daily' | 'weekly'; edition?: number;
  }): Promise<TournamentDoc> {
    const format = input.format ?? 'single-elim';
    const res = await this.db.collection(COLLECTIONS.tournaments).insertOne({
      title: input.title, status: 'DRAFT', mode: input.mode ?? 'ranked',
      timeControl: input.timeControl ?? '3+1',
      format,
      rounds: Math.min(Math.max(input.rounds ?? (format === 'swiss' ? 4 : 0), 0), 12),
      playersCap: Math.min(Math.max(input.playersCap ?? 16, 2), 128),
      ...(input.ownerId !== undefined ? { ownerId: input.ownerId } : {}),
      champion: null,
      ...(input.startAt !== undefined ? { startAt: input.startAt } : {}),
      ...(input.endAt !== undefined ? { endAt: input.endAt } : {}),
      recurrence: input.recurrence ?? 'none',
      edition: input.edition ?? 1,
      createdAt: new Date(),
    });
    const raw = await this.db.collection(COLLECTIONS.tournaments).findOne({ _id: res.insertedId });
    if (raw === null) throw new Error('tournament insert failed');
    return withDomainId<TournamentDoc>(raw as Record<string, unknown>);
  }

  async findById(id: string): Promise<TournamentDoc | null> {
    const oid = tryToObjectId(id);
    if (oid === null) return null;
    const raw = await this.db.collection(COLLECTIONS.tournaments).findOne({ _id: oid });
    return raw === null ? null : (withDomainId<TournamentDoc>(raw as Record<string, unknown>));
  }

  async setStatus(id: string, status: string): Promise<boolean> {
    const oid = tryToObjectId(id);
    if (oid === null) return false;
    const res = await this.db.collection(COLLECTIONS.tournaments).updateOne(
      { _id: oid }, { $set: { status } },
    );
    return res.matchedCount === 1;
  }

  async setChampion(id: string, champion: string | null): Promise<boolean> {
    const oid = tryToObjectId(id);
    if (oid === null) return false;
    const res = await this.db.collection(COLLECTIONS.tournaments).updateOne(
      { _id: oid }, { $set: { champion, status: 'FINISHED' } },
    );
    return res.matchedCount === 1;
  }

  /** Finished recurring series due for their next edition (missing nextRunAt counts as due). */
  async dueRecurrence(now: Date): Promise<TournamentDoc[]> {
    const rows = await this.db.collection(COLLECTIONS.tournaments)
      .find({
        status: 'FINISHED',
        recurrence: { $in: ['daily', 'weekly'] },
        $or: [{ nextRunAt: { $lte: now } }, { nextRunAt: { $exists: false } }],
      })
      .limit(50).toArray().catch(() => []);
    return rows.map((r) => withDomainId<TournamentDoc>(r as Record<string, unknown>));
  }

  async scheduleNext(id: string, nextRunAt: Date): Promise<boolean> {
    const oid = tryToObjectId(id);
    if (oid === null) return false;
    const res = await this.db.collection(COLLECTIONS.tournaments).updateOne(
      { _id: oid }, { $set: { nextRunAt } },
    );
    return res.matchedCount === 1;
  }

  async listRecent(limit = 20): Promise<TournamentDoc[]> {
    const rows = await this.db.collection(COLLECTIONS.tournaments)
      .find({}).sort({ createdAt: -1 }).limit(Math.min(Math.max(limit, 1), 100)).toArray();
    return rows.map((r) => withDomainId<TournamentDoc>(r as Record<string, unknown>));
  }

  async addPlayer(tournamentId: string, userId: string): Promise<void> {
    await this.db.collection(COLLECTIONS.tournament_players).updateOne(
      { tournamentId, userId },
      { $setOnInsert: { tournamentId, userId, joinedAt: new Date() } },
      { upsert: true },
    );
  }

  async listPlayers(tournamentId: string): Promise<{ userId: string; joinedAt: Date }[]> {
    const rows = await this.db.collection(COLLECTIONS.tournament_players)
      .find({ tournamentId }).sort({ joinedAt: 1 }).toArray();
    return rows.map((r) => ({
      userId: String((r as Record<string, unknown>)['userId']),
      joinedAt: (r as Record<string, unknown>)['joinedAt'] as Date,
    }));
  }

  async countPlayers(tournamentId: string): Promise<number> {
    return this.db.collection(COLLECTIONS.tournament_players).countDocuments({ tournamentId });
  }

  async saveRound(tournamentId: string, round: number, matches: { a: string | null; b: string | null; winner: string | null; gameId?: string }[]): Promise<void> {
    await this.db.collection(COLLECTIONS.tournament_rounds).updateOne(
      { tournamentId, round },
      { $set: { tournamentId, round, matches, updatedAt: new Date() }, $setOnInsert: { createdAt: new Date() } },
      { upsert: true },
    );
  }

  async listRounds(tournamentId: string): Promise<{ round: number; matches: { a: string | null; b: string | null; winner: string | null; gameId?: string }[] }[]> {
    const rows = await this.db.collection(COLLECTIONS.tournament_rounds)
      .find({ tournamentId }).sort({ round: 1 }).toArray();
    return rows.map((r) => ({
      round: Number((r as Record<string, unknown>)['round']),
      matches: ((r as Record<string, unknown>)['matches'] ?? []) as { a: string | null; b: string | null; winner: string | null; gameId?: string }[],
    }));
  }
}

export class NotificationRepository {
  constructor(private readonly db: Db) {}

  async create(input: { userId: string; kind: string; title: string; body?: string }): Promise<NotificationDoc> {
    const res = await this.db.collection(COLLECTIONS.notifications).insertOne({ ...input, read: false, createdAt: new Date() });
    const raw = await this.db.collection(COLLECTIONS.notifications).findOne({ _id: res.insertedId });
    if (raw === null) throw new Error('notification insert failed');
    return withDomainId<NotificationDoc>(raw as Record<string, unknown>);
  }

  async listForUser(userId: string, limit = 30): Promise<NotificationDoc[]> {
    const rows = await this.db.collection(COLLECTIONS.notifications)
      .find({ userId }).sort({ createdAt: -1 }).limit(limit).toArray();
    return rows.map((r) => withDomainId<NotificationDoc>(r as Record<string, unknown>));
  }

  async markRead(id: string, userId: string): Promise<boolean> {
    const oid = tryToObjectId(id);
    if (oid === null) return false;
    const res = await this.db.collection(COLLECTIONS.notifications).updateOne(
      { _id: oid, userId }, { $set: { read: true } },
    );
    return res.modifiedCount === 1;
  }
}

export class PuzzleRepository {
  constructor(private readonly db: Db) {}

  async findByPuzzleId(puzzleId: string): Promise<PuzzleDoc | null> {
    const raw = await this.db.collection(COLLECTIONS.puzzles).findOne({ puzzleId });
    return raw === null ? null : (withDomainId<PuzzleDoc>(raw as Record<string, unknown>));
  }

  async upsertDaily(input: { puzzleId: string; date: string; prompt: string; position: unknown; solution: unknown; needGain: number }): Promise<PuzzleDoc> {
    await this.db.collection(COLLECTIONS.puzzles).updateOne(
      { puzzleId: input.puzzleId },
      { $setOnInsert: { ...input, rating: 1200, createdAt: new Date() } },
      { upsert: true },
    );
    const doc = await this.findByPuzzleId(input.puzzleId);
    if (doc === null) throw new Error('daily puzzle upsert failed');
    return doc;
  }

  /** Distinct dates (YYYY-MM-DD) the user solved, newest first. */
  async solvedDates(userId: string, limit = 60): Promise<string[]> {
    const rows = await this.db.collection(COLLECTIONS.puzzle_attempts)
      .find({ userId, solved: true }).sort({ createdAt: -1 }).limit(limit * 3).toArray();
    const seen = new Set<string>();
    for (const r of rows) {
      const created = (r as Record<string, unknown>)['createdAt'];
      const d = created instanceof Date ? created.toISOString().slice(0, 10) : String(created ?? '').slice(0, 10);
      seen.add(d);
      if (seen.size >= limit) break;
    }
    return [...seen].sort().reverse();
  }

  async create(input: { prompt: string; solution: unknown; rating?: number }): Promise<PuzzleDoc> {
    const res = await this.db.collection(COLLECTIONS.puzzles).insertOne({
      prompt: input.prompt, solution: input.solution,
      rating: input.rating ?? 1200, createdAt: new Date(),
    });
    const raw = await this.db.collection(COLLECTIONS.puzzles).findOne({ _id: res.insertedId });
    if (raw === null) throw new Error('puzzle insert failed');
    return withDomainId<PuzzleDoc>(raw as Record<string, unknown>);
  }

  async recordAttempt(userId: string, puzzleId: string, solved: boolean): Promise<void> {
    await this.db.collection(COLLECTIONS.puzzle_attempts).insertOne({
      userId, puzzleId, solved, createdAt: new Date(),
    });
  }
}
