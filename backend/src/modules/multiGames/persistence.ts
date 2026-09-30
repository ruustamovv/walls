/**
 * Best-effort Mongo journaling for live multi games (mirrors
 * modules/games/persistence.ts). In-memory record stays authoritative.
 */
import { hashMultiState } from '../../../../engine/typescript/dist/index.js';
import { getMongoDb } from '../../database/mongodb/client.js';
import { GameRepository } from '../../database/mongodb/repositories/game.repository.js';
import { RatingRepository } from '../../database/mongodb/repositories/rating.repository.js';
import { UserRepository } from '../../database/mongodb/repositories/user.repository.js';
import { defaultRating } from '../ratings/glicko2.js';
import { logger } from '../../common/logging/logger.js';
import type { MultiGameRecord } from './service.js';

const docIdByEngineId = new Map<string, string>();

async function repos(): Promise<{ games: GameRepository; ratings: RatingRepository; users: UserRepository } | null> {
  try {
    const db = await getMongoDb();
    return {
      games: new GameRepository(db),
      ratings: new RatingRepository(db),
      users: new UserRepository(db),
    };
  } catch {
    return null;
  }
}

async function usernameOf(users: UserRepository, userId: string, fallback: string): Promise<string> {
  if (!/^[0-9a-fA-F]{24}$/.test(userId)) return fallback;
  const doc = await users.findById(userId).catch(() => null);
  return doc?.username ?? fallback;
}

export async function persistMultiGameCreated(g: MultiGameRecord): Promise<void> {
  if (docIdByEngineId.has(g.id)) return;
  const r = await repos();
  if (r === null) return;
  try {
    const existing = await r.games.findByEngineId(g.id).catch(() => null);
    if (existing !== null) {
      docIdByEngineId.set(g.id, existing._id);
      return;
    }
    const players: { userId: string; seat: number; usernameAtStart: string; ratingAtStart: number; clockMs: number }[] = [];
    for (let seat = 0; seat < g.playerIds.length; seat++) {
      const pid = g.playerIds[seat];
      if (pid === null) continue;
      const row = await r.ratings.get(pid, 'casual').catch(() => null);
      players.push({
        userId: pid,
        seat,
        usernameAtStart: await usernameOf(r.users, pid, `Player ${seat + 1}`),
        ratingAtStart: row?.rating ?? defaultRating().rating,
        clockMs: g.clock.remainingMs[seat] ?? 0,
      });
    }
    const doc = await r.games.createGame({
      engineId: g.id,
      mode: g.mode,
      timeControl: g.timeControlId,
      boardSize: g.state.size,
      wallCount: g.state.wallsPerPlayer,
      rulesVersion: g.state.rulesVersion,
      engineVersion: g.state.rulesVersion,
      players,
      variant: 'multi',
    });
    docIdByEngineId.set(g.id, doc._id);
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err), gameId: g.id }, 'persistMultiGameCreated failed (degraded)');
  }
}

export async function persistMultiMoveAppended(g: MultiGameRecord): Promise<void> {
  const docId = docIdByEngineId.get(g.id);
  if (docId === undefined) return;
  const r = await repos();
  if (r === null) return;
  const seq = g.actions.length - 1;
  const action = g.actions[seq];
  if (action === undefined) return;
  const moverSeat = g.state.isOver && g.state.winner !== null
    ? g.state.turn
    : (g.state.turn + g.state.players - 1) % g.state.players;
  const moverId = g.playerIds[moverSeat] ?? g.playerIds[0] ?? 'unknown';
  try {
    await r.games.appendMove({
      gameId: docId,
      sequence: seq,
      playerId: moverId,
      seat: moverSeat,
      action: action.type === 'move'
        ? { type: 'move', to: { r: action.to.r, c: action.to.c } }
        : { type: 'wall', wall: { r: action.wall.r, c: action.wall.c, orientation: action.wall.orientation } },
      serverTimeMs: g.clock.remainingMs[moverSeat] ?? 0,
      stateHash: hashMultiState(g.state),
    });
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err), gameId: g.id, seq }, 'persistMultiMoveAppended failed (degraded)');
  }
}

export async function persistMultiGameFinished(g: MultiGameRecord): Promise<void> {
  const docId = docIdByEngineId.get(g.id);
  if (docId === undefined) return;
  const r = await repos();
  if (r === null) return;
  try {
    await r.games.finishGame(
      docId,
      { winnerSeat: g.winnerSeat, reason: g.finishReason ?? 'goal' },
      hashMultiState(g.state),
    );
    // Record winner-first placement on the finished doc (best-effort).
    try {
      const db = await getMongoDb();
      const { COLLECTIONS } = await import('../../database/mongodb/collections.js');
      const { tryToObjectId } = await import('../../database/mongodb/ids.js');
      const oid = tryToObjectId(docId);
      if (oid !== null) {
        await db.collection(COLLECTIONS.games).updateOne({ _id: oid }, { $set: { placement: g.placement } });
      }
    } catch {
      // placement annotation advisory
    }
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err), gameId: g.id }, 'persistMultiGameFinished failed (degraded)');
  }
}
