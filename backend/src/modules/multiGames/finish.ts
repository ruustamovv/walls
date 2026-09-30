/**
 * Multi-game settlement: replay + result notifications + game journal.
 * V1 has NO rating writes (casual-only FFA; rated multi pools are a
 * follow-up). Exactly-once via the record's settled flag.
 */
import { hashMultiState, MULTI_RULES_VERSION } from '../../../../engine/typescript/dist/index.js';
import { getMongoDb } from '../../database/mongodb/client.js';
import { ReplayRepository } from '../../database/mongodb/repositories/replay.repository.js';
import { logger } from '../../common/logging/logger.js';
import type { MultiGameRecord } from './service.js';
import { persistMultiGameFinished } from './persistence.js';

export async function settleMultiGame(g: MultiGameRecord): Promise<void> {
  if (g.status !== 'finished' || g.settled) return;
  let db;
  try {
    db = await getMongoDb();
  } catch {
    return; // offline dev: result stands, retried on next read
  }
  try {
    const { NotificationRepository } = await import('../../database/mongodb/repositories/extended.repositories.js');
    const { SettingsRepository } = await import('../../database/mongodb/repositories/settings.repository.js');
    const notifs = new NotificationRepository(db);
    const settings = new SettingsRepository(db);
    for (let seat = 0; seat < g.playerIds.length; seat++) {
      const uid = g.playerIds[seat];
      if (uid === null) continue;
      const prefs = await settings.get(uid).catch(() => null);
      if (prefs !== null && !prefs.notifyResults) continue;
      const place = g.placement.indexOf(seat) + 1;
      await notifs.create({
        userId: uid,
        kind: 'result',
        title: place === 1
          ? `You won your ${g.state.players}-player ${g.timeControlId} game`
          : `You finished #${place} of ${g.state.players} (${g.timeControlId})`,
        body: g.id,
      }).catch(() => undefined);
    }

    const { trackEvent } = await import('../../database/mongodb/repositories/ops.repository.js');
    for (const uid of g.playerIds) {
      if (uid === null) continue;
      await trackEvent(db, uid, 'multi_game_finish', {
        players: g.state.players,
        winnerSeat: g.winnerSeat,
        placement: g.placement,
      }).catch(() => undefined);
    }

    const replays = new ReplayRepository(db);
    const existing = await replays.findByGame(g.id).catch(() => null);
    if (existing === null) {
      await replays.save({
        gameId: g.id,
        rulesVersion: MULTI_RULES_VERSION,
        engineVersion: MULTI_RULES_VERSION,
        initialState: { size: g.state.size, wallsPerPlayer: g.state.wallsPerPlayer, players: g.state.players, sides: g.state.sides },
        actions: g.actions.map((a) =>
          a.type === 'move'
            ? { type: 'move', to: { r: a.to.r, c: a.to.c } }
            : { type: 'wall', wall: { r: a.wall.r, c: a.wall.c, orientation: a.wall.orientation } },
        ),
        result: { winnerSeat: g.winnerSeat, reason: g.finishReason ?? 'goal' },
        hash: hashMultiState(g.state),
        visibility: 'public',
      });
    }
    await persistMultiGameFinished(g);
    g.settled = true;
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err), gameId: g.id }, 'multi settlement failed — will retry');
  }
}
