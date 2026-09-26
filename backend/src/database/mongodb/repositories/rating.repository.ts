/**
 * RatingRepository — one document per (userId, mode), history appended.
 * Rating changes use an atomic `$set` + history insert pair; callers that
 * need multi-document atomicity should use a session transaction and are
 * documented in `docs/architecture/mongodb-migrations.md`.
 */
import type { Db } from 'mongodb';
import { COLLECTIONS } from '../collections.js';
import { toDomainId, withDomainId } from '../ids.js';
import type { RatingDoc, RatingHistoryDoc } from '../types.js';

function toDoc(raw: Record<string, unknown>): RatingDoc {
  return {
    _id: toDomainId(raw['_id']),
    userId: String(raw['userId']),
    mode: String(raw['mode']),
    rating: Number(raw['rating']),
    deviation: Number(raw['deviation']),
    volatility: Number(raw['volatility']),
    games: Number(raw['games']),
    wins: Number(raw['wins']),
    losses: Number(raw['losses']),
    draws: Number(raw['draws']),
    peak: Number(raw['peak']),
    updatedAt: raw['updatedAt'] as Date,
  };
}

export class RatingRepository {
  constructor(private readonly db: Db) {}

  async get(userId: string, mode: string): Promise<RatingDoc | null> {
    const raw = await this.db.collection(COLLECTIONS.ratings).findOne({ userId, mode });
    return raw === null ? null : toDoc(raw as Record<string, unknown>);
  }

  /** Upsert the rating row and append a history record (never rewrite history). */
  async recordResult(opts: {
    userId: string; mode: string; before: number; after: number;
    rating: number; deviation: number; volatility: number;
    outcome: 'win' | 'loss' | 'draw'; gameId?: string;
  }): Promise<RatingDoc> {
    const now = new Date();
    const inc = { games: 1, wins: opts.outcome === 'win' ? 1 : 0, losses: opts.outcome === 'loss' ? 1 : 0, draws: opts.outcome === 'draw' ? 1 : 0 };
    const existing = await this.db.collection(COLLECTIONS.ratings).findOne({ userId: opts.userId, mode: opts.mode });
    const prevPeak = typeof existing?.['peak'] === 'number' ? (existing['peak'] as number) : opts.after;
    const res = await this.db.collection(COLLECTIONS.ratings).findOneAndUpdate(
      { userId: opts.userId, mode: opts.mode },
      {
        $set: {
          rating: opts.rating, deviation: opts.deviation, volatility: opts.volatility,
          updatedAt: now, peak: Math.max(prevPeak, opts.after),
        },
        $inc: inc,
        $setOnInsert: { userId: opts.userId, mode: opts.mode },
      },
      { upsert: true, returnDocument: 'after' },
    );
    const row = (res as unknown as Record<string, unknown> | null) ?? await this.db.collection(COLLECTIONS.ratings).findOne({ userId: opts.userId, mode: opts.mode });
    await this.db.collection(COLLECTIONS.rating_history).insertOne({
      userId: opts.userId, mode: opts.mode, gameId: opts.gameId,
      before: opts.before, after: opts.after, createdAt: now,
    });
    if (row === null) throw new Error('rating upsert did not return a document');
    return toDoc(row as Record<string, unknown>);
  }

  async history(userId: string, mode: string, limit = 50): Promise<RatingHistoryDoc[]> {
    const rows = await this.db.collection(COLLECTIONS.rating_history)
      .find({ userId, mode }).sort({ createdAt: -1 }).limit(limit).toArray();
    return rows.map((r) => withDomainId<RatingHistoryDoc>(r as Record<string, unknown>));
  }

  async leaderboard(mode: string, limit = 100): Promise<RatingDoc[]> {
    const rows = await this.db.collection(COLLECTIONS.ratings)
      .find({ mode }).sort({ rating: -1 }).limit(limit).toArray();
    return rows.map((r) => withDomainId<RatingDoc>(r as Record<string, unknown>));
  }
}
