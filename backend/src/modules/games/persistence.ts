/**
 * Best-effort Mongo persistence for live games.
 *
 * The in-memory GameRecord stays authoritative for the live match (clocks,
 * turns, validation). Every transition is ALSO journaled to Mongo when the
 * database is reachable: game doc at creation, append-only moves per ply,
 * exactly-once finish. When Mongo is down the match still plays; journaling
 * resumes for subsequent transitions (history may be partial — the live
 * result on the record is unaffected).
 *
 * Engine id (g_...) ↔ Mongo doc id mapping lives in this module.
 */
import { hashState } from '../../../../engine/typescript/dist/index.js';
import { getMongoDb } from '../../database/mongodb/client.js';
import { GameRepository } from '../../database/mongodb/repositories/game.repository.js';
import { RatingRepository } from '../../database/mongodb/repositories/rating.repository.js';
import { UserRepository } from '../../database/mongodb/repositories/user.repository.js';
import { defaultRating } from '../ratings/glicko2.js';
import { logger } from '../../common/logging/logger.js';
import type { GameRecord } from './service.js';

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

async function ratingOf(ratings: RatingRepository, userId: string, mode: string): Promise<number> {
  const row = await ratings.get(userId, mode).catch(() => null);
  return row?.rating ?? defaultRating().rating;
}

async function usernameOf(users: UserRepository, userId: string, fallback: string): Promise<string> {
  if (!/^[0-9a-fA-F]{24}$/.test(userId)) return fallback;
  const doc = await users.findById(userId).catch(() => null);
  return doc?.username ?? fallback;
}

/** Journal game creation (idempotent per engine id). */
export async function persistGameCreated(g: GameRecord, ratingMode: string): Promise<void> {
  if (docIdByEngineId.has(g.id)) return;
  const r = await repos();
  if (r === null) return;
  try {
    const existing = await r.games.findByEngineId(g.id).catch(() => null);
    if (existing !== null) {
      docIdByEngineId.set(g.id, existing._id);
      return;
    }
    const [aId, bId] = g.playerIds;
    const players: { userId: string; seat: 0 | 1; usernameAtStart: string; ratingAtStart: number; clockMs: number }[] = [];
    if (aId !== null) {
      players.push({
        userId: aId, seat: 0,
        usernameAtStart: await usernameOf(r.users, aId, 'Player 1'),
        ratingAtStart: await ratingOf(r.ratings, aId, ratingMode),
        clockMs: g.clock.remainingMs[0],
      });
    }
    if (bId !== null) {
      players.push({
        userId: bId, seat: 1,
        usernameAtStart: await usernameOf(r.users, bId, 'Player 2'),
        ratingAtStart: await ratingOf(r.ratings, bId, ratingMode),
        clockMs: g.clock.remainingMs[1],
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
      players: players as [{ userId: string; seat: 0 | 1; usernameAtStart: string; ratingAtStart: number; clockMs: number }],
      visibility: g.visibility,
    });
    docIdByEngineId.set(g.id, doc._id);
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err), gameId: g.id }, 'persistGameCreated failed (degraded)');
  }
}

/** Append the latest ply to the journal (exactly one doc per sequence). */
export async function persistMoveAppended(g: GameRecord): Promise<void> {
  const docId = docIdByEngineId.get(g.id);
  if (docId === undefined) return;
  const r = await repos();
  if (r === null) return;
  const seq = g.actions.length - 1;
  const action = g.actions[seq];
  if (action === undefined) return;
  // On a winning move the turn stays with the mover; otherwise it flipped.
  const moverSeat = (g.state.isOver && g.state.winner !== null ? g.state.turn : 1 - g.state.turn) as 0 | 1;
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
      stateHash: hashState(g.state),
    });
  } catch (err) {
    // Duplicate sequence = double-submit already journaled; anything else
    // is a degraded-mode gap in history (live result unaffected).
    logger.warn({ err: err instanceof Error ? err.message : String(err), gameId: g.id, seq }, 'persistMoveAppended failed (degraded)');
  }
}

/** Journal the terminal transition exactly once (version-guarded). */
export async function persistGameFinished(g: GameRecord): Promise<void> {
  const docId = docIdByEngineId.get(g.id);
  if (docId === undefined) return;
  const r = await repos();
  if (r === null) return;
  try {
    await r.games.finishGame(
      docId,
      { winnerSeat: g.winnerSeat, reason: g.finishReason ?? 'goal' },
      hashState(g.state),
    );
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err), gameId: g.id }, 'persistGameFinished failed (degraded)');
  }
}
