/**
 * Post-game settlement: ratings + replay persistence.
 *
 * Best-effort by design: when Mongo is unreachable the in-memory game result
 * still stands (the authoritative result lives on the GameRecord) and
 * settlement is retried on the next read of the finished game. The
 * `settled` flag on the record guarantees exactly-once side effects per
 * process; the rating upsert + append-only history keep replays idempotent
 * across restarts.
 */
import {
  RULES_VERSION,
  hashState,
} from '../../../../engine/typescript/dist/index.js';
import { getMongoDb } from '../../database/mongodb/client.js';
import { RatingRepository } from '../../database/mongodb/repositories/rating.repository.js';
import { ReplayRepository } from '../../database/mongodb/repositories/replay.repository.js';
import { defaultRating, updateRatings } from '../ratings/glicko2.js';
import { logger } from '../../common/logging/logger.js';
import type { GameRecord } from './service.js';

/** Rating bucket per time control (Bullet/Blitz/Rapid split). */
export function ratingModeFor(timeControlId: string): string {
  if (timeControlId.startsWith('1+')) return 'bullet';
  if (timeControlId.startsWith('3+')) return 'blitz';
  if (timeControlId.startsWith('5+')) return 'rapid';
  return 'casual';
}

export async function settleFinishedGame(g: GameRecord): Promise<void> {
  if (g.status !== 'finished' || g.settled) return;
  if (g.playerIds[1] === null) {
    // Single-seat (abandoned/waiting) games produce no ratings or replays.
    g.settled = true;
    return;
  }
  let db;
  try {
    db = await getMongoDb();
  } catch {
    return; // offline dev: result stands, settlement retried on next read
  }
  try {
    const mode = ratingModeFor(g.timeControlId);
    const ratings = new RatingRepository(db);
    const [aId, bId] = g.playerIds as [string, string];
    const [ra, rb] = await Promise.all([ratings.get(aId, mode), ratings.get(bId, mode)]);
    const ga = ra === null ? defaultRating() : { rating: ra.rating, rd: ra.deviation, vol: ra.volatility };
    const gb = rb === null ? defaultRating() : { rating: rb.rating, rd: rb.deviation, vol: rb.volatility };
    const scoreA = g.winnerSeat === null ? 0.5 : g.winnerSeat === 0 ? 1 : 0;
    const scoreB = 1 - scoreA;
    const na = updateRatings(ga, [{ rating: gb.rating, rd: gb.rd, score: scoreA }]);
    const nb = updateRatings(gb, [{ rating: ga.rating, rd: ga.rd, score: scoreB }]);
    await ratings.recordResult({
      userId: aId, mode, before: ga.rating, after: Math.round(na.rating),
      rating: Math.round(na.rating), deviation: na.rd, volatility: na.vol,
      outcome: scoreA === 1 ? 'win' : scoreA === 0 ? 'loss' : 'draw', gameId: g.id,
    });
    await ratings.recordResult({
      userId: bId, mode, before: gb.rating, after: Math.round(nb.rating),
      rating: Math.round(nb.rating), deviation: nb.rd, volatility: nb.vol,
      outcome: scoreB === 1 ? 'win' : scoreB === 0 ? 'loss' : 'draw', gameId: g.id,
    });

    const replays = new ReplayRepository(db);
    const existing = await replays.findByGame(g.id).catch(() => null);
    if (existing === null) {
      await replays.save({
        gameId: g.id,
        rulesVersion: RULES_VERSION,
        engineVersion: RULES_VERSION,
        initialState: { size: g.state.size, wallsPerPlayer: g.state.wallsPerPlayer },
        actions: g.actions.map((a) =>
          a.type === 'move'
            ? { type: 'move', to: { r: a.to.r, c: a.to.c } }
            : { type: 'wall', wall: { r: a.wall.r, c: a.wall.c, orientation: a.wall.orientation } },
        ),
        result: { winnerSeat: g.winnerSeat, reason: g.finishReason ?? 'goal' },
        hash: hashState(g.state),
        visibility: 'public',
      });
    }
    g.settled = true;
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err), gameId: g.id }, 'game settlement failed — will retry');
  }
}
