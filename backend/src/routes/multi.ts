/**
 * Multi-game routes (N-seat free-for-all, casual-only v1).
 * Registered by buildApp alongside registerV1.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { normalizeIntent } from '../common/validation/schemas.js';
import { AuthError, ValidationError } from '../common/errors/errors.js';
import { getAuthService } from '../modules/auth/service.js';
import { multiGamesService } from '../modules/multiGames/service.js';
import { settleMultiGame } from '../modules/multiGames/finish.js';
import { persistMultiGameCreated, persistMultiGameFinished, persistMultiMoveAppended } from '../modules/multiGames/persistence.js';
import { MultiMatchQueue } from '../modules/matchmaking/multiQueue.js';

const multiQueue = new MultiMatchQueue();
const matchByUser = new Map<string, string>();

function getSessionId(req: { cookies: Record<string, string | undefined>; headers: Record<string, string | string[] | undefined> }): string | null {
  const fromCookie = req.cookies['nexus_session'];
  if (typeof fromCookie === 'string' && fromCookie.length > 0) return fromCookie;
  const h = req.headers['authorization'];
  if (typeof h === 'string' && h.startsWith('Bearer ')) return h.slice(7);
  return null;
}

/** Signed-in user or null (used by fog-aware reads). */
async function optionalUserId(req: FastifyRequest): Promise<string | null> {
  try {
    return await requireUserId(req);
  } catch {
    return null;
  }
}

async function requireUserId(req: FastifyRequest): Promise<string> {
  const cookies = (req as unknown as { cookies?: Record<string, string | undefined> }).cookies ?? {};
  const sid = getSessionId({ cookies, headers: req.headers });
  if (sid === null) throw new AuthError('Missing session');
  const me = await (await getAuthService()).me(sid);
  if (me === null) throw new AuthError('Invalid session');
  return me.id;
}

const CreateMultiSchema = z.object({
  players: z.number().int().min(2).max(6).default(4),
  boardSize: z.number().int().min(5).max(25).optional(),
  wallsPerPlayer: z.number().int().min(0).max(30).optional(),
  timeControl: z.enum(['1+0', '1+1', '3+0', '3+1', '5+0', '5+1', '10+0', '10+5']).default('3+0'),
  visibility: z.enum(['public', 'friends', 'unlisted', 'private']).optional(),
  continueForPlacement: z.boolean().optional(),
  teamMode: z.boolean().optional(),
  fog: z.boolean().optional(),
  chaos: z.boolean().optional(),
  siege: z.boolean().optional(),
});

const MultiJoinSchema = z.object({
  players: z.number().int().min(2).max(6).default(4),
  timeControl: z.enum(['1+0', '1+1', '3+0', '3+1', '5+0', '5+1', '10+0', '10+5']).default('3+0'),
});

export async function registerMulti(app: FastifyInstance): Promise<void> {
  /** @openapi POST /api/v1/multi/games — create an open party game (invite link). */
  app.post('/api/v1/multi/games', async (req) => {
    const userId = await requireUserId(req);
    const parsed = CreateMultiSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw new ValidationError('Invalid party options');
    const g = multiGamesService.create({
      creatorId: userId,
      players: parsed.data.players,
      ...(parsed.data.boardSize !== undefined ? { boardSize: parsed.data.boardSize } : {}),
      ...(parsed.data.wallsPerPlayer !== undefined ? { wallsPerPlayer: parsed.data.wallsPerPlayer } : {}),
      timeControl: parsed.data.timeControl,
      ...(parsed.data.visibility !== undefined ? { visibility: parsed.data.visibility } : {}),
      ...(parsed.data.continueForPlacement !== undefined ? { continueForPlacement: parsed.data.continueForPlacement } : {}),
      ...(parsed.data.teamMode !== undefined ? { teamMode: parsed.data.teamMode } : {}),
      ...(parsed.data.fog !== undefined ? { fog: parsed.data.fog } : {}),
      ...(parsed.data.chaos !== undefined ? { chaos: parsed.data.chaos } : {}),
      ...(parsed.data.siege !== undefined ? { siege: parsed.data.siege } : {}),
    });
    void persistMultiGameCreated(g).catch(() => undefined);
    return multiGamesService.snapshot(g);
  });

  /** @openapi GET /api/v1/multi/games/:id — snapshot (ticks server clock). */
  app.get('/api/v1/multi/games/:id', async (req) => {
    const userId = await optionalUserId(req).catch(() => null);
    const { id } = req.params as { id: string };
    const g = multiGamesService.get(id);
    multiGamesService.tickClock(g, Date.now());
    if (g.status === 'finished' && !g.settled) {
      void settleMultiGame(g).catch(() => undefined);
    }
    // Fog (MLT-009): project to the caller's seat so REST polling gets the
    // same view the socket sends.
    const seat = userId === null ? null : g.playerIds.indexOf(userId);
    return multiGamesService.snapshot(g, seat === -1 ? null : seat);
  });

  /** @openapi POST /api/v1/multi/games/:id/join — take an open seat. */
  app.post('/api/v1/multi/games/:id/join', async (req) => {
    const userId = await requireUserId(req);
    const { id } = req.params as { id: string };
    const g = multiGamesService.join(id, userId);
    if (g.status === 'active') {
      void persistMultiGameCreated(g).catch(() => undefined);
    }
    return multiGamesService.snapshot(g, g.playerIds.indexOf(userId));
  });

  /** @openapi POST /api/v1/multi/games/:id/move — pawn move or wall. */
  app.post('/api/v1/multi/games/:id/move', async (req) => {
    const userId = await requireUserId(req);
    const { id } = req.params as { id: string };
    const parsed = normalizeIntent(req.body);
    if (!parsed.success) throw new ValidationError('Invalid action');
    const g = multiGamesService.play(id, userId, parsed.data.action, {
      ...(parsed.data.actionId !== undefined ? { actionId: parsed.data.actionId } : {}),
      ...(parsed.data.baseMoveNumber !== undefined ? { baseMoveNumber: parsed.data.baseMoveNumber } : {}),
    });
    void persistMultiMoveAppended(g).catch(() => undefined);
    if (g.status === 'finished' && !g.settled) {
      await settleMultiGame(g);
    }
    return multiGamesService.snapshot(g, g.playerIds.indexOf(userId));
  });

  /** @openapi POST /api/v1/multi/games/:id/resign — concede (placement by distance). */
  app.post('/api/v1/multi/games/:id/resign', async (req) => {
    const userId = await requireUserId(req);
    const { id } = req.params as { id: string };
    const g = multiGamesService.resign(id, userId);
    if (!g.settled) {
      await settleMultiGame(g);
    }
    return multiGamesService.snapshot(g, g.playerIds.indexOf(userId));
  });

  /** @openapi GET /api/v1/multi/games/:id/meta — seat identities for HUD. */
  app.get('/api/v1/multi/games/:id/meta', async (req) => {
    const { id } = req.params as { id: string };
    const g = multiGamesService.get(id);
    const labels = await Promise.all(
      g.playerIds.map(async (pid, seat) => {
        if (pid === null) return null;
        try {
          const { getMongoDb } = await import('../database/mongodb/client.js');
          const { UserRepository } = await import('../database/mongodb/repositories/user.repository.js');
          const db = await getMongoDb();
          const user = /^[0-9a-fA-F]{24}$/.test(pid)
            ? await new UserRepository(db).findById(pid).catch(() => null)
            : null;
          return { id: pid, username: user?.username ?? `Player ${seat + 1}` };
        } catch {
          return { id: pid, username: `Player ${seat + 1}` };
        }
      }),
    );
    return { players: labels };
  });

  /** @openapi GET /api/v1/multi/games/live — active party games. */
  app.get('/api/v1/multi/games/live', async () => ({
    games: multiGamesService
      .listActive(20)
      .filter((g) => g.visibility === 'public')
      .map((g) => ({ id: g.id, players: g.state.players, timeControl: g.timeControlId, moveCount: g.actions.length })),
  }));

  /** @openapi POST /api/v1/matchmaking/multi/join — quick-match bucket (casual). */
  app.post('/api/v1/matchmaking/multi/join', async (req) => {
    const userId = await requireUserId(req);
    const parsed = MultiJoinSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw new ValidationError('Invalid matchmaking options');
    await multiQueue.join({
      userId,
      players: parsed.data.players,
      timeControl: parsed.data.timeControl,
      joinedAt: Date.now(),
    });
    const group = await multiQueue.tryMatch(parsed.data.players, parsed.data.timeControl);
    if (group === null) return { status: 'queued' as const };
    const g = multiGamesService.create({
      creatorId: group[0]?.userId ?? userId,
      players: parsed.data.players,
      timeControl: parsed.data.timeControl,
    });
    // Fill seats in queue order (creator already seat 0).
    for (const t of group.slice(1)) {
      multiGamesService.join(g.id, t.userId);
    }
    for (const t of group) matchByUser.set(t.userId, g.id);
    void persistMultiGameCreated(g).catch(() => undefined);
    return { status: 'matched' as const, gameId: g.id };
  });

  /** @openapi GET /api/v1/matchmaking/multi/status — poll for a party match. */
  app.get('/api/v1/matchmaking/multi/status', async (req) => {
    const userId = await requireUserId(req);
    const gameId = matchByUser.get(userId);
    if (gameId === undefined) return { status: 'queued' as const };
    matchByUser.delete(userId);
    return { status: 'matched' as const, gameId };
  });

  /** @openapi POST /api/v1/matchmaking/multi/cancel — leave the bucket. */
  app.post('/api/v1/matchmaking/multi/cancel', async (req) => {
    const userId = await requireUserId(req);
    await multiQueue.cancel(userId);
    return { ok: true };
  });
}
