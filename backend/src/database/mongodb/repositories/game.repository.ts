/**
 * GameRepository — durable game records + append-only move log.
 * - `games` holds one small document per game (players as snapshots).
 * - `game_moves` holds one document per ply with a unique (gameId, sequence)
 *   index, so double-submits are rejected by the database.
 * - `finishGame` uses optimistic concurrency (`version`) for exactly-once results.
 */
import type { Db } from 'mongodb';
import { z } from 'zod';
import { COLLECTIONS } from '../collections.js';
import { toDomainId, tryToObjectId } from '../ids.js';
import type { GameDoc, GameMoveDoc, GameStatus } from '../types.js';

export const CreateGameSchema = z.object({
  /** Engine-side game id (g_...) linking the live record to this document. */
  engineId: z.string().min(1).max(80).optional(),
  mode: z.string().min(1).max(32).default('ranked'),
  timeControl: z.string().min(1).max(16).default('3+1'),
  boardSize: z.number().int().min(5).max(25).default(9),
  wallCount: z.number().int().min(0).max(60).default(10),
  rulesVersion: z.string().default('1.0.0'),
  engineVersion: z.string().default('1.0.0'),
  players: z.array(z.object({
    userId: z.string().min(1),
    seat: z.union([z.literal(0), z.literal(1)]),
    usernameAtStart: z.string().min(1),
    ratingAtStart: z.number(),
    clockMs: z.number().int().positive(),
  })).min(1).max(2),
});
export type CreateGameInput = z.input<typeof CreateGameSchema>;

function gameToDoc(raw: Record<string, unknown>): GameDoc {
  return { ...(raw as unknown as GameDoc), _id: toDomainId(raw['_id']) };
}

export class GameRepository {
  constructor(private readonly db: Db) {}

  async createGame(input: CreateGameInput): Promise<GameDoc> {
    const parsed = CreateGameSchema.parse(input);
    const now = new Date();
    const res = await this.db.collection(COLLECTIONS.games).insertOne({
      ...parsed,
      status: 'WAITING' satisfies GameStatus,
      currentTurn: 0,
      moveCount: 0,
      createdAt: now,
      version: 1,
    });
    const raw = await this.db.collection(COLLECTIONS.games).findOne({ _id: res.insertedId });
    if (raw === null) throw new Error('game insert did not return a document');
    return gameToDoc(raw as Record<string, unknown>);
  }

  async findById(id: string): Promise<GameDoc | null> {
    const oid = tryToObjectId(id);
    if (oid === null) return null;
    const raw = await this.db.collection(COLLECTIONS.games).findOne({ _id: oid });
    return raw === null ? null : gameToDoc(raw as Record<string, unknown>);
  }

  async findByEngineId(engineId: string): Promise<GameDoc | null> {
    const raw = await this.db.collection(COLLECTIONS.games).findOne({ engineId });
    return raw === null ? null : gameToDoc(raw as Record<string, unknown>);
  }

  /** Newest game docs overall (admin / spectator directories). */
  async listRecent(limit = 20): Promise<GameDoc[]> {
    const rows = await this.db.collection(COLLECTIONS.games)
      .find({})
      .sort({ createdAt: -1 })
      .limit(Math.min(Math.max(limit, 1), 100))
      .toArray();
    return rows.map((r) => gameToDoc(r as Record<string, unknown>));
  }

  /** Recent games for a user, newest first (profile history). */
  async listByUser(userId: string, limit = 20): Promise<GameDoc[]> {
    const rows = await this.db.collection(COLLECTIONS.games)
      .find({ 'players.userId': userId })
      .sort({ createdAt: -1 })
      .limit(Math.min(Math.max(limit, 1), 100))
      .toArray();
    return rows.map((r) => gameToDoc(r as Record<string, unknown>));
  }

  async setStatus(id: string, status: GameStatus): Promise<boolean> {
    const oid = tryToObjectId(id);
    if (oid === null) return false;
    const res = await this.db.collection(COLLECTIONS.games).updateOne(
      { _id: oid },
      { $set: { status }, $inc: { version: 1 } },
    );
    return res.matchedCount === 1;
  }

  /** Append a move; duplicate sequence for the same game throws (unique index). */
  async appendMove(move: Omit<GameMoveDoc, '_id' | 'timestamp'>): Promise<GameMoveDoc> {
    const res = await this.db.collection(COLLECTIONS.game_moves).insertOne({ ...move, timestamp: new Date() });
    const raw = await this.db.collection(COLLECTIONS.game_moves).findOne({ _id: res.insertedId });
    if (raw === null) throw new Error('move insert did not return a document');
    return { ...(raw as unknown as GameMoveDoc), _id: toDomainId(raw['_id']) };
  }

  async listMoves(gameId: string): Promise<GameMoveDoc[]> {
    const rows = await this.db.collection(COLLECTIONS.game_moves)
      .find({ gameId }).sort({ sequence: 1 }).toArray();
    return rows.map((r) => ({ ...(r as unknown as GameMoveDoc), _id: toDomainId((r as Record<string, unknown>)['_id']) }));
  }

  /**
   * Finish a game exactly once. The `version` guard means a second caller
   * (e.g. duplicate timeout + resign racing) gets `false` instead of
   * overwriting the recorded result.
   */
  async finishGame(id: string, result: NonNullable<GameDoc['result']>, finalStateHash: string): Promise<boolean> {
    const oid = tryToObjectId(id);
    if (oid === null) return false;
    const current = await this.findById(id);
    if (current === null || current.status === 'FINISHED') return false;
    const res = await this.db.collection(COLLECTIONS.games).updateOne(
      { _id: oid, version: current.version, status: { $ne: 'FINISHED' } },
      {
        $set: { status: 'FINISHED', result, finalStateHash, finishedAt: new Date() },
        $inc: { version: 1 },
      },
    );
    return res.modifiedCount === 1;
  }
}
