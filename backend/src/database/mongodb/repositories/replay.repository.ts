/**
 * ReplayRepository — compact deterministic replays.
 * Stores initial state + ordered actions (not per-move board snapshots);
 * the engine reconstructs state. Unique index on gameId.
 */
import type { Db } from 'mongodb';
import { COLLECTIONS } from '../collections.js';
import { withDomainId } from '../ids.js';
import type { ReplayDoc } from '../types.js';

export class ReplayRepository {
  constructor(private readonly db: Db) {}

  async save(replay: Omit<ReplayDoc, '_id' | 'createdAt'>): Promise<ReplayDoc> {
    const res = await this.db.collection(COLLECTIONS.replays).insertOne({ ...replay, createdAt: new Date() });
    const raw = await this.db.collection(COLLECTIONS.replays).findOne({ _id: res.insertedId });
    if (raw === null) throw new Error('replay insert did not return a document');
    return withDomainId<ReplayDoc>(raw as Record<string, unknown>);
  }

  async findByGame(gameId: string): Promise<ReplayDoc | null> {
    const raw = await this.db.collection(COLLECTIONS.replays).findOne({ gameId });
    if (raw === null) return null;
    return withDomainId<ReplayDoc>(raw as Record<string, unknown>);
  }
}
