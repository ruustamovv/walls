/**
 * FairPlayRepository — durable conduct records (one doc per user).
 * Pure scoring lives in modules/fairplay/service.ts; this is storage only.
 */
import type { Db } from 'mongodb';
import { COLLECTIONS } from '../collections.js';
import {
  blankConduct,
  decayConduct,
  applyConductEvent,
  type ConductEvent,
  type ConductRecord,
} from '../../../modules/fairplay/service.js';

export class FairPlayRepository {
  constructor(private readonly db: Db) {}

  async get(userId: string, now: number = Date.now()): Promise<ConductRecord> {
    const raw = await this.db.collection(COLLECTIONS.fairplay).findOne({ userId }).catch(() => null);
    if (raw === null) return blankConduct(userId, now);
    const rec: ConductRecord = {
      userId,
      score: typeof raw['score'] === 'number' ? raw['score'] : 100,
      abandons: typeof raw['abandons'] === 'number' ? raw['abandons'] : 0,
      completions: typeof raw['completions'] === 'number' ? raw['completions'] : 0,
      abuses: typeof raw['abuses'] === 'number' ? raw['abuses'] : 0,
      updatedAt: raw['updatedAt'] instanceof Date ? raw['updatedAt'].getTime() : now,
    };
    return decayConduct(rec, now);
  }

  async record(userId: string, event: ConductEvent, now: number = Date.now()): Promise<ConductRecord> {
    const next = applyConductEvent(await this.get(userId, now), event, now);
    await this.db.collection(COLLECTIONS.fairplay).updateOne(
      { userId },
      {
        $set: {
          score: next.score,
          abandons: next.abandons,
          completions: next.completions,
          abuses: next.abuses,
          updatedAt: new Date(next.updatedAt),
        },
      },
      { upsert: true },
    ).catch(() => undefined);
    return next;
  }
}
