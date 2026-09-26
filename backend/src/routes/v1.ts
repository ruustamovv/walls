/**
 * API v1 routes — server-authoritative game platform.
 *
 * Auth resolves to Mongo-backed accounts when the database is reachable
 * (offline dev falls back to memory). Matchmaking prefers the Redis queue
 * store with an in-memory fallback. Finished games settle ratings + replays
 * best-effort; the live result on the GameRecord is authoritative regardless.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  CreateGameSchema,
  GameActionSchema,
  LoginSchema,
  MatchmakingJoinSchema,
  RegisterSchema,
} from '../common/validation/schemas.js';
import { AuthError, ValidationError } from '../common/errors/errors.js';
import { getAuthService } from '../modules/auth/service.js';
import { gamesService } from '../modules/games/service.js';
import { persistGameCreated, persistGameFinished, persistMoveAppended } from '../modules/games/persistence.js';
import { ratingModeFor, settleFinishedGame } from '../modules/games/finish.js';
import { InMemoryQueueStore, MatchmakingQueue } from '../modules/matchmaking/queue.js';
import { RedisQueueStore } from '../database/redis/matchmakingStore.js';
import { defaultRating } from '../modules/ratings/glicko2.js';
import { activeProvider, providerStatuses, CoachRequestSchema } from '../modules/ai/provider.js';

const memoryQueue = new MatchmakingQueue(new InMemoryQueueStore());
const redisQueue = new MatchmakingQueue(new RedisQueueStore());
/** userId -> gameId for matches created while the player was polling. */
const matchByUser = new Map<string, string>();

let redisQueueOk: boolean | null = null;
let redisQueueCheckedAt = 0;

/** Prefer the shared Redis queue; fall back to memory when Redis is down. */
async function getQueue(): Promise<MatchmakingQueue> {
  if (redisQueueOk !== null && Date.now() - redisQueueCheckedAt < 30000) {
    return redisQueueOk ? redisQueue : memoryQueue;
  }
  try {
    const { connectRedis } = await import('../database/redis/client.js');
    redisQueueOk = await connectRedis();
  } catch {
    redisQueueOk = false;
  }
  redisQueueCheckedAt = Date.now();
  return redisQueueOk ? redisQueue : memoryQueue;
}

function getSessionId(req: { cookies: Record<string, string | undefined>; headers: Record<string, string | string[] | undefined> }): string | null {
  const fromCookie = req.cookies['nexus_session'];
  if (typeof fromCookie === 'string' && fromCookie.length > 0) return fromCookie;
  const h = req.headers['authorization'];
  if (typeof h === 'string' && h.startsWith('Bearer ')) return h.slice(7);
  return null;
}

async function requireUserId(req: FastifyRequest): Promise<string> {
  const cookies = (req as unknown as { cookies?: Record<string, string | undefined> }).cookies ?? {};
  const sid = getSessionId({ cookies, headers: req.headers });
  if (sid === null) throw new AuthError('Missing session');
  const me = await (await getAuthService()).me(sid);
  if (me === null) throw new AuthError('Invalid session');
  return me.id;
}

/** Board preset per queue mode: ranked plays Standard, everything else Classic. */
function presetForMode(mode: string): { boardSize: number; wallsPerPlayer: number } {
  return mode === 'ranked' ? { boardSize: 15, wallsPerPlayer: 20 } : { boardSize: 9, wallsPerPlayer: 10 };
}

async function storedRating(userId: string, timeControl: string): Promise<number> {
  try {
    const { getMongoDb } = await import('../database/mongodb/client.js');
    const { RatingRepository } = await import('../database/mongodb/repositories/rating.repository.js');
    const db = await getMongoDb();
    const row = await new RatingRepository(db).get(userId, ratingModeFor(timeControl));
    return row?.rating ?? defaultRating().rating;
  } catch {
    return defaultRating().rating;
  }
}

/**
 * @openapi /api/v1/health — liveness probe (no deps).
 * @openapi /api/v1/ready  — readiness probe (db/redis optional).
 * @openapi /api/v1/live   — alias of health for k8s.
 */
export async function registerV1(app: FastifyInstance): Promise<void> {
  // ── Probes ─────────────────────────────────────────
  app.get('/api/v1/health', async () => ({ ok: true, service: 'nexus-backend' }));
  app.get('/api/v1/live', async () => ({ ok: true }));
  app.get('/api/v1/ready', async () => {
    const { checkMongoHealth } = await import('../database/mongodb/health.js');
    const { checkRedisHealth } = await import('../database/redis/health.js');
    const [mongo, redis] = await Promise.all([checkMongoHealth(), checkRedisHealth()]);
    return {
      ok: mongo.ok,
      checks: {
        mongo: mongo.ok ? `OK (${mongo.database ?? 'db'})` : `FAIL: ${mongo.error ?? 'unreachable'}`,
        redis: redis.ok ? 'OK' : 'DEGRADED',
      },
    };
  });

  // ── Auth ───────────────────────────────────────────
  /** @openapi POST /api/v1/auth/register — create account (rate-limited). */
  app.post('/api/v1/auth/register', async (req, reply) => {
    const parsed = RegisterSchema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError('Invalid registration', { body: ['invalid'] });
    const res = await (await getAuthService()).register(parsed.data);
    void reply.setCookie('nexus_session', res.session.id, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
    });
    return { user: res.user };
  });

  /** @openapi POST /api/v1/auth/login — start session (rate-limited). */
  app.post('/api/v1/auth/login', async (req, reply) => {
    const parsed = LoginSchema.safeParse(req.body);
    if (!parsed.success) throw new AuthError('Invalid credentials');
    const res = await (await getAuthService()).login(parsed.data);
    void reply.setCookie('nexus_session', res.session.id, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
    });
    return { user: res.user };
  });

  /** @openapi POST /api/v1/auth/logout — revoke session. */
  app.post('/api/v1/auth/logout', async (req) => {
    const cookies = (req as unknown as { cookies?: Record<string, string | undefined> }).cookies ?? {};
    const sid = getSessionId({ cookies, headers: req.headers });
    if (sid !== null) await (await getAuthService()).logout(sid);
    return { ok: true };
  });

  /** @openapi GET /api/v1/auth/me — current session user. */
  app.get('/api/v1/auth/me', async (req) => {
    const cookies = (req as unknown as { cookies?: Record<string, string | undefined> }).cookies ?? {};
    const sid = getSessionId({ cookies, headers: req.headers });
    if (sid === null) throw new AuthError('Missing session');
    const me = await (await getAuthService()).me(sid);
    if (me === null) throw new AuthError('Invalid session');
    return { user: { id: me.id, email: me.email, username: me.username, role: me.role } };
  });

  // ── Games ──────────────────────────────────────────
  /** @openapi POST /api/v1/games — create game (server-authoritative). */
  app.post('/api/v1/games', async (req) => {
    const userId = await requireUserId(req);
    const parsed = CreateGameSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw new ValidationError('Invalid game options');
    const g = gamesService.create({
      creatorId: userId,
      boardSize: parsed.data.boardSize,
      wallsPerPlayer: parsed.data.wallsPerPlayer,
      timeControl: parsed.data.timeControl,
      ...(parsed.data.opponentId !== undefined ? { opponentId: parsed.data.opponentId } : {}),
    });
    if (g.playerIds[1] !== null) {
      void persistGameCreated(g, ratingModeFor(g.timeControlId)).catch(() => undefined);
    }
    return gamesService.snapshot(g);
  });

  /** @openapi GET /api/v1/games/:id — fetch snapshot (ticks server clock). */
  app.get('/api/v1/games/:id', async (req) => {
    const { id } = req.params as { id: string };
    const g = gamesService.get(id);
    gamesService.tickClock(g, Date.now());
    if (g.status === 'finished' && !g.settled) {
      // Timeout (or join-race) settlement must not slow the read path.
      void settleFinishedGame(g)
        .then(() => persistGameFinished(g))
        .catch(() => undefined);
    }
    return gamesService.snapshot(g);
  });

  /** @openapi GET /api/v1/games/live — active games for spectating. */
  app.get('/api/v1/games/live', async () => ({
    games: gamesService
      .listActive(20)
      .map((g) => ({ id: g.id, mode: g.mode, timeControl: g.timeControlId, moveCount: g.actions.length })),
  }));

  /** @openapi GET /api/v1/games/:id/meta — seat identities for HUD labels. */
  app.get('/api/v1/games/:id/meta', async (req) => {
    const { id } = req.params as { id: string };
    const g = gamesService.get(id);
    const labels = await Promise.all(
      g.playerIds.map(async (pid, seat) => {
        if (pid === null) return null;
        try {
          const { getMongoDb } = await import('../database/mongodb/client.js');
          const { UserRepository } = await import('../database/mongodb/repositories/user.repository.js');
          const { RatingRepository } = await import('../database/mongodb/repositories/rating.repository.js');
          const db = await getMongoDb();
          const user = /^[0-9a-fA-F]{24}$/.test(pid)
            ? await new UserRepository(db).findById(pid).catch(() => null)
            : null;
          const rating = await new RatingRepository(db).get(pid, ratingModeFor(g.timeControlId)).catch(() => null);
          return {
            id: pid,
            username: user?.username ?? `Player ${seat + 1}`,
            rating: rating?.rating ?? defaultRating().rating,
          };
        } catch {
          return { id: pid, username: `Player ${seat + 1}`, rating: defaultRating().rating };
        }
      }),
    );
    return { players: labels };
  });

  /** @openapi POST /api/v1/games/:id/join — take the second seat. */
  app.post('/api/v1/games/:id/join', async (req) => {
    const userId = await requireUserId(req);
    const { id } = req.params as { id: string };
    const g = gamesService.join(id, userId);
    void persistGameCreated(g, ratingModeFor(g.timeControlId)).catch(() => undefined);
    return gamesService.snapshot(g);
  });

  /** @openapi POST /api/v1/games/:id/move — MAKE_MOVE / PLACE_WALL. */
  app.post('/api/v1/games/:id/move', async (req) => {
    const userId = await requireUserId(req);
    const { id } = req.params as { id: string };
    const parsed = GameActionSchema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError('Invalid action');
    const g = gamesService.play(id, userId, parsed.data);
    void persistMoveAppended(g).catch(() => undefined);
    if (g.status === 'finished' && !g.settled) {
      await settleFinishedGame(g);
      await persistGameFinished(g);
    }
    return gamesService.snapshot(g);
  });

  /** @openapi POST /api/v1/games/:id/resign — concede immediately. */
  app.post('/api/v1/games/:id/resign', async (req) => {
    const userId = await requireUserId(req);
    const { id } = req.params as { id: string };
    const g = gamesService.resign(id, userId);
    if (!g.settled) {
      await settleFinishedGame(g);
      await persistGameFinished(g);
    }
    return gamesService.snapshot(g);
  });

  // ── Matchmaking ────────────────────────────────────
  /** @openapi POST /api/v1/matchmaking/join — join queue (anti-duplicate). */
  app.post('/api/v1/matchmaking/join', async (req) => {
    const userId = await requireUserId(req);
    const parsed = MatchmakingJoinSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw new ValidationError('Invalid matchmaking options');
    // Server-side rating lookup; client rating never trusted.
    const rating = await storedRating(userId, parsed.data.timeControl);
    const queue = await getQueue();
    await queue.join({
      userId,
      mode: parsed.data.mode,
      timeControl: parsed.data.timeControl,
      rating,
      joinedAt: Date.now(),
    });
    const pair = await queue.tryMatch();
    if (pair === null) return { status: 'queued' as const };
    const preset = presetForMode(pair.a.mode);
    const g = gamesService.create({
      creatorId: pair.a.userId,
      opponentId: pair.b.userId,
      timeControl: pair.a.timeControl,
      mode: pair.a.mode,
      boardSize: preset.boardSize,
      wallsPerPlayer: preset.wallsPerPlayer,
    });
    matchByUser.set(pair.a.userId, g.id);
    matchByUser.set(pair.b.userId, g.id);
    void persistGameCreated(g, ratingModeFor(g.timeControlId)).catch(() => undefined);
    return { status: 'matched' as const, gameId: g.id };
  });

  /** @openapi GET /api/v1/matchmaking/status — poll for a match. */
  app.get('/api/v1/matchmaking/status', async (req) => {
    const userId = await requireUserId(req);
    const gameId = matchByUser.get(userId);
    if (gameId === undefined) return { status: 'queued' as const };
    matchByUser.delete(userId);
    return { status: 'matched' as const, gameId };
  });

  /** @openapi POST /api/v1/matchmaking/cancel — leave queue. */
  app.post('/api/v1/matchmaking/cancel', async (req) => {
    const userId = await requireUserId(req);
    const queue = await getQueue();
    await queue.cancel(userId);
    return { ok: true };
  });

  // ── Profiles / leaderboard ─────────────────────────
  /** @openapi GET /api/v1/profiles/:username — public profile with ratings + recent games. */
  app.get('/api/v1/profiles/:username', async (req) => {
    const { username } = req.params as { username: string };
    try {
      const { getMongoDb } = await import('../database/mongodb/client.js');
      const { UserRepository } = await import('../database/mongodb/repositories/user.repository.js');
      const { RatingRepository } = await import('../database/mongodb/repositories/rating.repository.js');
      const { GameRepository } = await import('../database/mongodb/repositories/game.repository.js');
      const db = await getMongoDb();
      const users = new UserRepository(db);
      const doc = await users.findByUsername(username);
      if (doc === null) throw new ValidationError('Player not found');
      const ratings = new RatingRepository(db);
      const modes = ['bullet', 'blitz', 'rapid', 'casual'] as const;
      const rows = await Promise.all(modes.map((m) => ratings.get(doc._id, m)));
      const games = await new GameRepository(db).listByUser(doc._id, 10);
      return {
        username: doc.username,
        joinedAt: doc.createdAt,
        ratings: modes.map((m, i) => ({
          mode: m,
          rating: rows[i]?.rating ?? defaultRating().rating,
          peak: rows[i]?.peak ?? defaultRating().rating,
          games: rows[i]?.games ?? 0,
          wins: rows[i]?.wins ?? 0,
          losses: rows[i]?.losses ?? 0,
        })),
        recentGames: games.map((game) => ({
          id: game.engineId ?? game._id,
          mode: game.mode,
          timeControl: game.timeControl,
          status: game.status,
          result: game.result ?? null,
          createdAt: game.createdAt,
        })),
      };
    } catch (err) {
      if (err instanceof ValidationError) throw err;
      // Offline dev: shape stays stable, values honestly empty.
      return { username, ratings: [], recentGames: [], degraded: true };
    }
  });

  /** @openapi GET /api/v1/leaderboard — top players per mode. */
  app.get('/api/v1/leaderboard', async (req) => {
    const query = req.query as { mode?: string };
    const mode = typeof query.mode === 'string' ? query.mode : 'blitz';
    try {
      const { getMongoDb } = await import('../database/mongodb/client.js');
      const { RatingRepository } = await import('../database/mongodb/repositories/rating.repository.js');
      const { UserRepository } = await import('../database/mongodb/repositories/user.repository.js');
      const db = await getMongoDb();
      const ratings = new RatingRepository(db);
      const users = new UserRepository(db);
      const rows = await ratings.leaderboard(mode, 50);
      const entries = await Promise.all(
        rows.map(async (row, i) => ({
          rank: i + 1,
          username: (await users.findById(row.userId).catch(() => null))?.username ?? 'unknown',
          rating: row.rating,
          games: row.games,
          wins: row.wins,
        })),
      );
      return { mode, entries };
    } catch {
      return { mode, entries: [], degraded: true };
    }
    // RBAC note: admin-only fields (email, bans) never leave through this route.
  });

  // ── AI (optional providers, graceful when unconfigured) ──
  /** @openapi GET /api/v1/ai/status — provider availability (no secrets). */
  app.get('/api/v1/ai/status', async () => ({
    providers: providerStatuses(),
    active: activeProvider(),
  }));

  /** @openapi POST /api/v1/ai/coach — explain engine facts (503 when unconfigured). */
  app.post('/api/v1/ai/coach', async (req) => {
    const parsed = CoachRequestSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw new ValidationError('Invalid coach request');
    const provider = activeProvider();
    if (provider === null) {
      return {
        available: false as const,
        message: 'AI Coach is not configured on this deployment. Post-game engine analysis below is still available.',
      };
    }
    // Provider call wiring lands with the first configured deployment;
    // until then report honestly instead of fabricating an explanation.
    return {
      available: false as const,
      provider: provider.id,
      message: 'AI provider is configured but live coaching calls are not enabled in this build yet.',
    };
  });
}
