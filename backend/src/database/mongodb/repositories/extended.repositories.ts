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

  async create(input: { title: string; mode?: string; timeControl?: string; startAt?: Date; endAt?: Date }): Promise<TournamentDoc> {
    const res = await this.db.collection(COLLECTIONS.tournaments).insertOne({
      title: input.title, status: 'DRAFT', mode: input.mode ?? 'ranked',
      timeControl: input.timeControl ?? '3+1',
      ...(input.startAt !== undefined ? { startAt: input.startAt } : {}),
      ...(input.endAt !== undefined ? { endAt: input.endAt } : {}),
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

  async addPlayer(tournamentId: string, userId: string): Promise<void> {
    await this.db.collection(COLLECTIONS.tournament_players).updateOne(
      { tournamentId, userId },
      { $setOnInsert: { tournamentId, userId, joinedAt: new Date() } },
      { upsert: true },
    );
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
