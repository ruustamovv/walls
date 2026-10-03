/**
 * API v1 routes — server-authoritative game platform.
 *
 * Auth resolves to Mongo-backed accounts when the database is reachable
 * (offline dev falls back to memory). Matchmaking prefers the Redis queue
 * store with an in-memory fallback. Finished games settle ratings + replays
 * best-effort; the live result on the GameRecord is authoritative regardless.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  CreateGameSchema,
  LoginSchema,
  MatchmakingJoinSchema,
  normalizeIntent,
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

/** Live queue depths for the admin dashboard (memory always, Redis best-effort). */
export async function matchmakingDepths(): Promise<{ memory: number; redisRanked: number | null; redisOk: boolean }> {
  const memory = await memoryQueue.size().catch(() => -1);
  try {
    const { connectRedis } = await import('../database/redis/client.js');
    if (!(await connectRedis(800))) return { memory, redisRanked: null, redisOk: false };
    const depth = await redisQueue.size().catch(() => null);
    return { memory, redisRanked: depth, redisOk: true };
  } catch {
    return { memory, redisRanked: null, redisOk: false };
  }
}
/** userId -> gameId for matches created while the player was polling. */
const matchByUser = new Map<string, string>();

/** 60s headline-stats cache (public counters route). */
let publicStatsCache: { at: number; body: { users: number; gamesToday: number } } | null = null;

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

/** Full record (includes the guest flag) for guest-gated routes. */
async function requireUser(req: FastifyRequest): Promise<{ id: string; guest: boolean }> {
  const cookies = (req as unknown as { cookies?: Record<string, string | undefined> }).cookies ?? {};
  const sid = getSessionId({ cookies, headers: req.headers });
  if (sid === null) throw new AuthError('Missing session');
  const me = await (await getAuthService()).me(sid);
  if (me === null) throw new AuthError('Invalid session');
  return { id: me.id, guest: me.guest };
}

/** Guests are casual-only: no ranked queue, no ranked games, no ratings. */
function rejectRankedForGuest(guest: boolean, mode: string | undefined): void {
  if (guest && mode !== undefined && mode !== 'casual') {
    throw new ValidationError('Guests play casual — create an account for ranked');
  }
}

/** Board preset per queue mode: ranked plays Standard, everything else Classic. */
function presetForMode(mode: string): { boardSize: number; wallsPerPlayer: number } {
  return mode === 'ranked' ? { boardSize: 15, wallsPerPlayer: 20 } : { boardSize: 9, wallsPerPlayer: 10 };
}

/** Rating plus rated-games count (matchmaking sizes the window from both). */
async function storedRatingRow(userId: string, timeControl: string): Promise<{ rating: number; games: number }> {
  try {
    const { getMongoDb } = await import('../database/mongodb/client.js');
    const { RatingRepository } = await import('../database/mongodb/repositories/rating.repository.js');
    const db = await getMongoDb();
    const row = await new RatingRepository(db).get(userId, ratingModeFor(timeControl));
    if (row === null) {
      const d = defaultRating();
      return { rating: d.rating, games: 0 };
    }
    return { rating: row.rating, games: row.games ?? 0 };
  } catch {
    const d = defaultRating();
    return { rating: d.rating, games: 0 };
  }
}

/**
 * @openapi /api/v1/health — liveness probe (no deps).
 * @openapi /api/v1/ready  — readiness probe (db/redis optional).
 * @openapi /api/v1/live   — alias of health for k8s.
 */
export async function registerV1(app: FastifyInstance): Promise<void> {
  // ── Probes ─────────────────────────────────────────
  app.get('/api/v1/health', async () => ({ ok: true, service: 'quoridor-backend' }));
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
  /**
   * @openapi POST /api/v1/auth/availability — is this email/username free?
   * Lets the signup form tell the user BEFORE submitting instead of failing
   * after. Always returns 200 with booleans: this is a hint, not an
   * authorisation — the unique indexes remain the source of truth, so a race
   * still fails safely at register time.
   */
  app.post('/api/v1/auth/availability', async (req) => {
    const body = (req.body ?? {}) as { email?: unknown; username?: unknown };
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const username = typeof body.username === 'string' ? body.username.trim() : '';
    // Validate shape locally so we never probe garbage (and never leak whether
    // an invalid value happens to collide).
    const emailOk = z.string().email().max(254).safeParse(email).success;
    const usernameOk = z.string().min(3).max(24).regex(/^[a-zA-Z0-9_]+$/).safeParse(username).success;
    const out = { emailAvailable: true, usernameAvailable: true, checked: false };
    if (!emailOk && !usernameOk) return out;
    try {
      const { getMongoDb } = await import('../database/mongodb/client.js');
      const { UserRepository } = await import('../database/mongodb/repositories/user.repository.js');
      const db = await getMongoDb();
      const users = new UserRepository(db);
      if (emailOk) out.emailAvailable = (await users.findByEmail(email)) === null;
      if (usernameOk) out.usernameAvailable = (await users.findByUsername(username)) === null;
      out.checked = true;
    } catch {
      // Offline: report "available" and let register be the judge.
      return out;
    }
    return out;
  });

  /** @openapi POST /api/v1/auth/register — create account (rate-limited). */
  app.post('/api/v1/auth/register', async (req, reply) => {
    const parsed = RegisterSchema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError('Invalid registration', { body: ['invalid'] });
    const res = await (await getAuthService()).register(parsed.data);
    void (async () => {
      try {
        const { getMongoDb } = await import('../database/mongodb/client.js');
        const { trackEvent } = await import('../database/mongodb/repositories/ops.repository.js');
        const db = await getMongoDb();
        await trackEvent(db, res.user.id, 'signup', {});
      } catch {
        // telemetry advisory
      }
    })();
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

  /** @openapi POST /api/v1/socket/ticket — single-use socket auth ticket. */  app.post('/api/v1/socket/ticket', async (req) => {
    const userId = await requireUserId(req);
    const { issueSocketTicket } = await import('../realtime/tickets.js');
    return issueSocketTicket(userId);
  });

  /** @openapi POST /api/v1/auth/logout — revoke session. */  app.post('/api/v1/auth/logout', async (req) => {
    const cookies = (req as unknown as { cookies?: Record<string, string | undefined> }).cookies ?? {};
    const sid = getSessionId({ cookies, headers: req.headers });
    if (sid !== null) await (await getAuthService()).logout(sid);
    return { ok: true };
  });

  /** @openapi POST /api/v1/auth/guest — ephemeral guest session (tightly rate-limited). */
  app.post('/api/v1/auth/guest', { config: { rateLimit: { max: 30, timeWindow: '1 hour' } } }, async (_req, reply) => {
    const res = await (await getAuthService()).createGuest();
    void reply.setCookie('nexus_session', res.session.id, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
    });
    return { user: res.user };
  });

  /** @openapi POST /api/v1/auth/convert — upgrade a guest session to a full account. */
  app.post('/api/v1/auth/convert', async (req, reply) => {
    const cookies = (req as unknown as { cookies?: Record<string, string | undefined> }).cookies ?? {};
    const sid = getSessionId({ cookies, headers: req.headers });
    if (sid === null) throw new AuthError('Missing session');
    const svc = await getAuthService();
    const cur = await svc.me(sid);
    if (cur === null) throw new AuthError('Invalid session');
    if (!cur.guest) throw new ValidationError('Only guest sessions can be converted');
    const parsed = RegisterSchema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError('Invalid registration', { body: ['invalid'] });
    const res = await svc.convertGuest(cur.id, parsed.data);
    void reply.setCookie('nexus_session', res.session.id, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
    });
    return { user: res.user };
  });

  /** @openapi POST /api/v1/auth/forgot — request a reset link (always generic). */
  app.post('/api/v1/auth/forgot', async (req) => {
    const body = (req.body ?? {}) as { email?: string };
    if (typeof body.email === 'string' && body.email.length > 0) {
      const { requestReset } = await import('../modules/auth/passwordReset.js');
      await requestReset(body.email);
    }
    return { ok: true, message: 'If that address exists, a reset link is on its way.' };
  });

  /** @openapi POST /api/v1/auth/reset — consume a reset token. */  app.post('/api/v1/auth/reset', async (req) => {
    const body = (req.body ?? {}) as { token?: string; password?: string };
    if (typeof body.token !== 'string' || typeof body.password !== 'string' || body.password.length < 8 || body.password.length > 128) {
      throw new ValidationError('Invalid reset request');
    }
    const { confirmReset } = await import('../modules/auth/passwordReset.js');
    const svc = await getAuthService();
    const ok = await confirmReset(body.token, body.password, (uid) => svc.logoutAll(uid));
    if (!ok) throw new ValidationError('Reset link is invalid or expired');
    return { ok: true };
  });

  /** @openapi POST /api/v1/auth/verify/request — send a verification link. */
  app.post('/api/v1/auth/verify/request', async (req) => {
    const userId = await requireUserId(req);
    const { requestVerification } = await import('../modules/auth/verify.js');
    const { mailed } = await requestVerification(userId).catch(() => ({ mailed: false as boolean }));
    return { ok: true, mailed };
  });

  /** @openapi POST /api/v1/auth/verify/confirm — consume a verification token. */
  app.post('/api/v1/auth/verify/confirm', async (req) => {
    const body = (req.body ?? {}) as { token?: string };
    if (typeof body.token !== 'string' || body.token.length === 0) throw new ValidationError('Invalid verification request');
    const { confirmVerification } = await import('../modules/auth/verify.js');
    const ok = await confirmVerification(body.token);
    if (!ok) throw new ValidationError('Verification link is invalid or expired');
    return { ok: true };
  });

  /** @openapi GET /api/v1/auth/oauth/status — which social buttons to show. */
  app.get('/api/v1/auth/oauth/status', async () => {
    const { oauthStatus } = await import('../modules/auth/oauth.js');
    return oauthStatus();
  });

  /** @openapi GET /api/v1/auth/oauth/:provider — begin social login. */
  app.get('/api/v1/auth/oauth/:provider', async (req, reply) => {
    const { provider } = req.params as { provider: string };
    if (provider !== 'google' && provider !== 'github') throw new ValidationError('Unknown provider');
    const q = req.query as { next?: string };
    const { authorizeUrl } = await import('../modules/auth/oauth.js');
    try {
      const url = authorizeUrl(provider, typeof q.next === 'string' ? q.next : '/play');
      void reply.redirect(url);
    } catch (err) {
      throw new ValidationError(err instanceof Error ? err.message : 'OAuth unavailable');
    }
  });

  /** @openapi GET /api/v1/auth/oauth/:provider/callback — finish social login. */
  app.get('/api/v1/auth/oauth/:provider/callback', async (req, reply) => {
    const { provider } = req.params as { provider: string };
    if (provider !== 'google' && provider !== 'github') throw new ValidationError('Unknown provider');
    const q = req.query as { code?: string; state?: string };
    const { completeOAuth, oauthCallbackTarget } = await import('../modules/auth/oauth.js');
    if (typeof q.code !== 'string' || typeof q.state !== 'string') {
      void reply.redirect(oauthCallbackTarget('/play', false));
      return;
    }
    try {
      const { sessionId, next } = await completeOAuth(provider, q.code, q.state);
      void reply
        .setCookie('nexus_session', sessionId, { httpOnly: true, sameSite: 'lax', path: '/' })
        .redirect(oauthCallbackTarget(next, true));
    } catch {
      void reply.redirect(oauthCallbackTarget('/play', false));
    }
  });

  /** @openapi POST /api/v1/auth/password — change password (knowing the old one). */
  app.post('/api/v1/auth/password', async (req) => {
    const userId = await requireUserId(req);
    const body = (req.body ?? {}) as { current?: string; next?: string };
    if (typeof body.current !== 'string' || typeof body.next !== 'string' || body.next.length < 8 || body.next.length > 128) {
      throw new ValidationError('Invalid password change');
    }
    const { getMongoDb } = await import('../database/mongodb/client.js');
    const { UserRepository } = await import('../database/mongodb/repositories/user.repository.js');
    const { verifyPassword, hashPassword } = await import('../modules/auth/hashing.js');
    const db = await getMongoDb();
    const users = new UserRepository(db);
    const doc = await users.findById(userId);
    if (doc === null) throw new AuthError('Invalid session');
    if (!(await verifyPassword(doc.passwordHash, body.current))) throw new AuthError('Current password is wrong');
    await users.updatePassword(userId, await hashPassword(body.next));
    return { ok: true };
  });

  /** @openapi POST /api/v1/auth/logout-all — revoke every session. */
  app.post('/api/v1/auth/logout-all', async (req) => {
    const userId = await requireUserId(req);
    const count = await (await getAuthService()).logoutAll(userId);
    return { ok: true, revoked: count };
  });

  /** @openapi POST /api/v1/auth/delete — close my account. */
  app.post('/api/v1/auth/delete', async (req) => {
    const userId = await requireUserId(req);
    const { getMongoDb } = await import('../database/mongodb/client.js');
    const { UserRepository } = await import('../database/mongodb/repositories/user.repository.js');
    const db = await getMongoDb();
    await new UserRepository(db).updateStatus(userId, 'DELETED');
    await (await getAuthService()).logoutAll(userId);
    return { ok: true, message: 'Account closed. Competitive records stay anonymized for leaderboard integrity.' };
  });

  /** @openapi GET /api/v1/settings — my preferences. */
  app.get('/api/v1/settings', async (req) => {
    const userId = await requireUserId(req);
    const { getMongoDb } = await import('../database/mongodb/client.js');
    const { SettingsRepository } = await import('../database/mongodb/repositories/settings.repository.js');
    const db = await getMongoDb();
    return new SettingsRepository(db).get(userId);
  });

  /** @openapi PUT /api/v1/settings — save my preferences. */
  app.put('/api/v1/settings', async (req) => {
    const userId = await requireUserId(req);
    const { SettingsSchema } = await import('../common/validation/settings.js');
    const parsed = SettingsSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw new ValidationError('Invalid settings');
    const { getMongoDb } = await import('../database/mongodb/client.js');
    const { SettingsRepository } = await import('../database/mongodb/repositories/settings.repository.js');
    const db = await getMongoDb();
    return new SettingsRepository(db).save(userId, parsed.data);
  });

  /** @openapi GET /api/v1/auth/me — current session user. */
  app.get('/api/v1/auth/me', async (req) => {
    const cookies = (req as unknown as { cookies?: Record<string, string | undefined> }).cookies ?? {};
    const sid = getSessionId({ cookies, headers: req.headers });
    if (sid === null) throw new AuthError('Missing session');
    const me = await (await getAuthService()).me(sid);
    if (me === null) throw new AuthError('Invalid session');
    return { user: { id: me.id, email: me.email, username: me.username, role: me.role, guest: me.guest, emailVerified: me.emailVerified } };
  });

  // ── Games ──────────────────────────────────────────
  /** @openapi POST /api/v1/games — create game (server-authoritative). */
  app.post('/api/v1/games', async (req) => {
    const me = await requireUser(req);
    const userId = me.id;
    const parsed = CreateGameSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw new ValidationError('Invalid game options');
    if (parsed.data.opponentId !== undefined) {
      // Respect challenge preferences (best-effort; open when Mongo is down).
      try {
        const { getMongoDb } = await import('../database/mongodb/client.js');
        const { SettingsRepository } = await import('../database/mongodb/repositories/settings.repository.js');
        const db = await getMongoDb();
        const prefs = await new SettingsRepository(db).get(parsed.data.opponentId);
        if (!prefs.allowChallenges) throw new ValidationError('That player is not accepting challenges');
      } catch (err) {
        if (err instanceof ValidationError) throw err;
      }
    }
    const g = gamesService.create({
      creatorId: userId,
      boardSize: parsed.data.boardSize,
      wallsPerPlayer: parsed.data.wallsPerPlayer,
      timeControl: parsed.data.timeControl,
      // Guests are casual-only; any game involving a guest is casual (GST-001).
      mode: me.guest || (parsed.data.opponentId !== undefined && await (await getAuthService()).isGuest(parsed.data.opponentId).catch(() => false))
        ? 'casual'
        : 'ranked',
      ...(parsed.data.opponentId !== undefined ? { opponentId: parsed.data.opponentId } : {}),
      ...(parsed.data.visibility !== undefined ? { visibility: parsed.data.visibility } : {}),
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
      .filter((g) => g.visibility === 'public')
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
    const parsed = normalizeIntent(req.body);
    if (!parsed.success) throw new ValidationError('Invalid action');
    const g = gamesService.play(id, userId, parsed.data.action, {
      ...(parsed.data.actionId !== undefined ? { actionId: parsed.data.actionId } : {}),
      ...(parsed.data.baseMoveNumber !== undefined ? { baseMoveNumber: parsed.data.baseMoveNumber } : {}),
    });
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

  /** @openapi POST /api/v1/games/:id/draw-offer — propose a draw. */
  app.post('/api/v1/games/:id/draw-offer', async (req) => {
    const userId = await requireUserId(req);
    const { id } = req.params as { id: string };
    return gamesService.snapshot(gamesService.offerDraw(id, userId));
  });

  /** @openapi POST /api/v1/games/:id/draw-response — answer a draw offer. */
  app.post('/api/v1/games/:id/draw-response', async (req) => {
    const userId = await requireUserId(req);
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as { accept?: boolean };
    if (typeof body.accept !== 'boolean') throw new ValidationError('Invalid response');
    const g = gamesService.respondDraw(id, userId, body.accept);
    if (g.status === 'finished' && !g.settled) {
      await settleFinishedGame(g);
      await persistGameFinished(g);
    }
    return gamesService.snapshot(g);
  });

  // ── Matchmaking ────────────────────────────────────
  /** @openapi POST /api/v1/matchmaking/join — join queue (anti-duplicate). */
  app.post('/api/v1/matchmaking/join', async (req) => {
    const me = await requireUser(req);
    const userId = me.id;
    const parsed = MatchmakingJoinSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw new ValidationError('Invalid matchmaking options');
    rejectRankedForGuest(me.guest, parsed.data.mode);
    // Server-side rating lookup; client rating never trusted.
    const { rating, games } = await storedRatingRow(userId, parsed.data.timeControl);
    const { conductScoreOf } = await import('../modules/fairplay/outcomes.js');
    const behavior = await conductScoreOf(userId);
    const queue = await getQueue();
    await queue.join({
      userId,
      mode: parsed.data.mode,
      timeControl: parsed.data.timeControl,
      rating,
      gamesPlayed: games,
      joinedAt: Date.now(),
      behavior,
      ...(parsed.data.region !== undefined ? { region: parsed.data.region } : {}),
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
    void (async () => {
      try {
        const { getMongoDb } = await import('../database/mongodb/client.js');
        const { NotificationRepository } = await import('../database/mongodb/repositories/extended.repositories.js');
        const { SettingsRepository } = await import('../database/mongodb/repositories/settings.repository.js');
        const db = await getMongoDb();
        const notifs = new NotificationRepository(db);
        const settings = new SettingsRepository(db);
        for (const uid of [pair.a.userId, pair.b.userId]) {
          const prefs = await settings.get(uid).catch(() => null);
          if (prefs !== null && !prefs.notifyMatches) continue;
          await notifs.create({ userId: uid, kind: 'match', title: `Match found — ${pair.a.timeControl} ${pair.a.mode}`, body: g.id }).catch(() => undefined);
        }
      } catch {
        // notifications are advisory
      }
    })();
    return { status: 'matched' as const, gameId: g.id };
  });

  /** @openapi GET /api/v1/matchmaking/status — poll for a match. */
  app.get('/api/v1/matchmaking/status', async (req) => {
    const userId = await requireUserId(req);
    const gameId = matchByUser.get(userId);
    if (gameId === undefined) {
      // Still waiting: tell the UI where the ticket stands.
      const queue = await getQueue();
      const info = await queue.describe(userId).catch(() => null);
      if (info === null) return { status: 'queued' as const };
      return { status: 'queued' as const, ...info };
    }
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

  // ── Friends / presence ─────────────────────────────
  /** @openapi POST /api/v1/friends/request — send a friend request. */
  app.post('/api/v1/friends/request', async (req) => {
    const me = await requireUser(req);
    if (me.guest) throw new ValidationError('Guests cannot send friend requests — create an account first');
    const userId = me.id;
    const body = (req.body ?? {}) as { username?: string };
    if (typeof body.username !== 'string' || body.username.length < 3) throw new ValidationError('Invalid username');
    const { sendRequest } = await import('../modules/friends/service.js');
    try {
      return await sendRequest(userId, body.username);
    } catch (err) {
      throw new ValidationError(err instanceof Error ? err.message : 'Request failed');
    }
  });

  /** @openapi GET /api/v1/friends/requests — incoming pending requests. */
  app.get('/api/v1/friends/requests', async (req) => {
    const userId = await requireUserId(req);
    const { incomingRequests } = await import('../modules/friends/service.js');
    return { requests: await incomingRequests(userId) };
  });

  /** @openapi POST /api/v1/friends/accept — accept a request. */
  app.post('/api/v1/friends/accept', async (req) => {
    const userId = await requireUserId(req);
    const body = (req.body ?? {}) as { requestId?: string };
    if (typeof body.requestId !== 'string') throw new ValidationError('Invalid request');
    const { acceptRequest } = await import('../modules/friends/service.js');
    const ok = await acceptRequest(userId, body.requestId);
    if (!ok) throw new ValidationError('Request not found');
    return { ok: true };
  });

  /** @openapi GET /api/v1/friends — friend list with presence. */
  app.get('/api/v1/friends', async (req) => {
    const userId = await requireUserId(req);
    const { listFriends, heartbeat } = await import('../modules/friends/service.js');
    // Reading your own list counts as activity for presence.
    void heartbeat(userId).catch(() => undefined);
    return { friends: await listFriends(userId) };
  });

  /** @openapi POST /api/v1/friends/block — block a player. */
  app.post('/api/v1/friends/block', async (req) => {
    const userId = await requireUserId(req);
    const body = (req.body ?? {}) as { username?: string };
    if (typeof body.username !== 'string') throw new ValidationError('Invalid username');
    const { blockUser } = await import('../modules/friends/service.js');
    try {
      await blockUser(userId, body.username);
    } catch (err) {
      throw new ValidationError(err instanceof Error ? err.message : 'Block failed');
    }
    return { ok: true };
  });

  /** DM channel: deterministic per friend-pair, friendship-gated. */
  function dmChannel(a: string, b: string): string {
    return `dm:${a < b ? `${a}|${b}` : `${b}|${a}`}`;
  }

  /** @openapi GET /api/v1/dms — threads (friends with last message). */
  app.get('/api/v1/dms', async (req) => {
    const userId = await requireUserId(req);
    const { getMongoDb } = await import('../database/mongodb/client.js');
    const { ChatRepository } = await import('../database/mongodb/repositories/chat.repository.js');
    const db = await getMongoDb();
    const chat = new ChatRepository(db);
    const { listFriends } = await import('../modules/friends/service.js');
    const rows = await listFriends(userId);
    const threads = await Promise.all(
      rows.map(async (f) => {
        const last = (await chat.history(dmChannel(userId, f.id), 1).catch(() => []))[0];
        return {
          username: f.username,
          online: f.online,
          lastBody: last?.body ?? null,
          lastAt: last?.createdAt ?? null,
        };
      }),
    );
    return { threads };
  });

  /** @openapi GET /api/v1/dms/:username — thread history (friends only). */
  app.get('/api/v1/dms/:username', async (req) => {
    const me = await requireUser(req);
    const userId = me.id;
    const { username } = req.params as { username: string };
    if (me.guest) throw new ValidationError('Guests cannot use messages — create an account first');
    const { getMongoDb } = await import('../database/mongodb/client.js');
    const { UserRepository } = await import('../database/mongodb/repositories/user.repository.js');
    const { FriendRepository } = await import('../database/mongodb/repositories/social.repository.js');
    const { ChatRepository } = await import('../database/mongodb/repositories/chat.repository.js');
    const db = await getMongoDb();
    const target = await new UserRepository(db).findByUsername(username);
    if (target === null) throw new ValidationError('Player not found');
    if (!(await new FriendRepository(db).areFriends(userId, target._id).catch(() => false))) {
      throw new ValidationError('You are friends only with each other here');
    }
    const messages = await new ChatRepository(db).history(dmChannel(userId, target._id), 50);
    return {
      messages: messages.map((m) => ({
        _id: m._id, userId: m.userId, body: m.body,
        createdAt: m.createdAt instanceof Date ? m.createdAt.toISOString() : m.createdAt,
      })),
    };
  });

  /** @openapi POST /api/v1/dms/:username — send (friends, scope + filter gates). */
  app.post('/api/v1/dms/:username', async (req) => {
    const me = await requireUser(req);
    const userId = me.id;
    if (me.guest) throw new ValidationError('Guests cannot use messages — create an account first');
    const { username } = req.params as { username: string };
    const body = (req.body ?? {}) as { body?: string };
    if (typeof body.body !== 'string' || body.body.trim().length === 0 || body.body.length > 500) {
      throw new ValidationError('Message must be 1–500 chars');
    }
    const { getMongoDb } = await import('../database/mongodb/client.js');
    const { UserRepository } = await import('../database/mongodb/repositories/user.repository.js');
    const { FriendRepository } = await import('../database/mongodb/repositories/social.repository.js');
    const { ChatRepository } = await import('../database/mongodb/repositories/chat.repository.js');
    const { SettingsRepository } = await import('../database/mongodb/repositories/settings.repository.js');
    const { scoreMessage, autoFlag } = await import('../modules/moderation/filter.js');
    const db = await getMongoDb();
    const target = await new UserRepository(db).findByUsername(username);
    if (target === null) throw new ValidationError('Player not found');
    if (!(await new FriendRepository(db).areFriends(userId, target._id).catch(() => false))) {
      throw new ValidationError('You are friends only with each other here');
    }
    const prefs = await new SettingsRepository(db).get(target._id).catch(() => null);
    if (prefs !== null && prefs.chatScope === 'nobody') {
      throw new ValidationError('That player is not accepting messages');
    }
    const verdict = scoreMessage(body.body);
    if (verdict.decision === 'block') {
      void autoFlag(db, userId, `dm:${username}`, body.body, verdict.reasons);
      throw new ValidationError('Message blocked by auto-moderation');
    }
    const saved = await new ChatRepository(db).post(dmChannel(userId, target._id), userId, body.body);
    if (verdict.decision === 'flag') {
      void autoFlag(db, userId, `dm:${username}`, body.body, verdict.reasons);
    }
    return {
      message: {
        _id: saved._id, userId: saved.userId, body: saved.body,
        createdAt: saved.createdAt instanceof Date ? saved.createdAt.toISOString() : saved.createdAt,
      },
    };
  });

  // ── Cosmetics ────────────────────────────────────────
  /** @openapi GET /api/v1/cosmetics — catalog with ownership for me. */
  app.get('/api/v1/cosmetics', async (req) => {
    const userId = await requireUserId(req);
    const { getMongoDb } = await import('../database/mongodb/client.js');
    const { CosmeticsRepository } = await import('../database/mongodb/repositories/cosmetics.repository.js');
    const { EntitlementRepository } = await import('../database/mongodb/repositories/premium.repository.js');
    const db = await getMongoDb();
    const hasPremium = await new EntitlementRepository(db).has(userId, 'PREMIUM_COSMETICS').catch(() => false);
    const repo = new CosmeticsRepository(db);
    return { frames: repo.catalogWith(hasPremium), equipped: await repo.equippedFrame(userId) };
  });

  /** @openapi POST /api/v1/cosmetics/:id/equip — wear an owned frame. */
  app.post('/api/v1/cosmetics/:id/equip', async (req) => {
    const userId = await requireUserId(req);
    const { id } = req.params as { id: string };
    const { getMongoDb } = await import('../database/mongodb/client.js');
    const { CosmeticsRepository } = await import('../database/mongodb/repositories/cosmetics.repository.js');
    const { EntitlementRepository } = await import('../database/mongodb/repositories/premium.repository.js');
    const { cosmeticById } = await import('../modules/cosmetics/catalog.js');
    const item = cosmeticById(id);
    if (item === null) throw new ValidationError('Unknown cosmetic');
    const db = await getMongoDb();
    if (item.premium) {
      const ok = await new EntitlementRepository(db).has(userId, 'PREMIUM_COSMETICS').catch(() => false);
      if (!ok) throw new ValidationError('Premium frame — unlock Premium first');
    }
    const equipped = await new CosmeticsRepository(db).equipFrame(userId, id);
    if (!equipped) throw new ValidationError('Unknown cosmetic');
    return { ok: true, equipped: id };
  });

  // ── Clubs ────────────────────────────────────────────  /** @openapi POST /api/v1/clubs — found a club. */
  app.post('/api/v1/clubs', async (req) => {
    const me = await requireUser(req);
    if (me.guest) throw new ValidationError('Guests cannot found clubs — create an account first');
    const userId = me.id;
    const body = (req.body ?? {}) as { name?: string; description?: string };
    if (typeof body.name !== 'string' || body.name.trim().length < 3) throw new ValidationError('Club name too short');
    const { getMongoDb } = await import('../database/mongodb/client.js');
    const { ClubRepository } = await import('../database/mongodb/repositories/club.repository.js');
    const db = await getMongoDb();
    try {
      const club = await new ClubRepository(db).create(userId, body.name, typeof body.description === 'string' ? body.description : '');
      return { club };
    } catch (err) {
      throw new ValidationError(err instanceof Error ? err.message : 'Club creation failed');
    }
  });

  /** @openapi GET /api/v1/clubs — browse clubs. */
  app.get('/api/v1/clubs', async () => {
    const { getMongoDb } = await import('../database/mongodb/client.js');
    const { ClubRepository } = await import('../database/mongodb/repositories/club.repository.js');
    const db = await getMongoDb();
    return { clubs: await new ClubRepository(db).list() };
  });

  /** @openapi GET /api/v1/clubs/:id — club detail with members. */
  app.get('/api/v1/clubs/:id', async (req) => {
    const { id } = req.params as { id: string };
    const { getMongoDb } = await import('../database/mongodb/client.js');
    const { ClubRepository } = await import('../database/mongodb/repositories/club.repository.js');
    const { UserRepository } = await import('../database/mongodb/repositories/user.repository.js');
    const db = await getMongoDb();
    const clubs = new ClubRepository(db);
    const club = await clubs.findById(id);
    if (club === null) throw new ValidationError('Club not found');
    const users = new UserRepository(db);
    const members = await Promise.all(
      (await clubs.members(id)).map(async (m) => ({
        id: m.userId,
        username: (await users.findById(m.userId).catch(() => null))?.username ?? 'unknown',
        role: m.role,
      })),
    );
    return { club, members };
  });

  /** @openapi POST /api/v1/clubs/:id/join — join a club. */
  app.post('/api/v1/clubs/:id/join', async (req) => {
    const me = await requireUser(req);
    if (me.guest) throw new ValidationError('Guests cannot join clubs — create an account first');
    const userId = me.id;
    const { id } = req.params as { id: string };
    const { getMongoDb } = await import('../database/mongodb/client.js');
    const { ClubRepository } = await import('../database/mongodb/repositories/club.repository.js');
    const db = await getMongoDb();
    const ok = await new ClubRepository(db).join(id, userId);
    if (!ok) throw new ValidationError('Club not found');
    return { ok: true };
  });

  /** @openapi POST /api/v1/clubs/:id/leave — leave a club. */
  app.post('/api/v1/clubs/:id/leave', async (req) => {
    const userId = await requireUserId(req);
    const { id } = req.params as { id: string };
    const { getMongoDb } = await import('../database/mongodb/client.js');
    const { ClubRepository } = await import('../database/mongodb/repositories/club.repository.js');
    const db = await getMongoDb();
    await new ClubRepository(db).leave(id, userId);
    return { ok: true };
  });

  /** @openapi GET /api/v1/clubs/:id/chat — recent club messages (members). */
  app.get('/api/v1/clubs/:id/chat', async (req) => {
    const userId = await requireUserId(req);
    const { id } = req.params as { id: string };
    const { getMongoDb } = await import('../database/mongodb/client.js');
    const { ClubRepository } = await import('../database/mongodb/repositories/club.repository.js');
    const { ChatRepository } = await import('../database/mongodb/repositories/chat.repository.js');
    const db = await getMongoDb();
    const members = await new ClubRepository(db).members(id);
    if (!members.some((m) => m.userId === userId)) throw new ValidationError('Club members only');
    return { messages: await new ChatRepository(db).history(`club:${id}`, 30) };
  });

  // ── Tournaments ────────────────────────────────────────
  /** @openapi POST /api/v1/tournaments — create (you auto-join). */
  app.post('/api/v1/tournaments', async (req) => {
    const userId = await requireUserId(req);
    const body = (req.body ?? {}) as { title?: string; format?: string; timeControl?: string; mode?: string; rounds?: number; playersCap?: number; durationMinutes?: number; recurrence?: string };
    const { createTournament } = await import('../modules/tournaments/service.js');
    try {
      const doc = await createTournament(userId, {
        title: typeof body.title === 'string' ? body.title : '',
        ...(body.format === 'single-elim' || body.format === 'round-robin' || body.format === 'swiss' || body.format === 'arena' ? { format: body.format } : {}),
        ...(typeof body.timeControl === 'string' ? { timeControl: body.timeControl } : {}),
        ...(typeof body.mode === 'string' ? { mode: body.mode } : {}),
        ...(typeof body.rounds === 'number' ? { rounds: body.rounds } : {}),
        ...(typeof body.playersCap === 'number' ? { playersCap: body.playersCap } : {}),
        ...(typeof body.durationMinutes === 'number' ? { durationMinutes: body.durationMinutes } : {}),
        ...(body.recurrence === 'daily' || body.recurrence === 'weekly' ? { recurrence: body.recurrence } : {}),
      });
      return { tournament: doc };
    } catch (err) {
      throw new ValidationError(err instanceof Error ? err.message : 'Tournament creation failed');
    }
  });

  /** @openapi GET /api/v1/tournaments — recent tournaments. */
  app.get('/api/v1/tournaments', async () => {
    const { getMongoDb } = await import('../database/mongodb/client.js');
    const { TournamentRepository } = await import('../database/mongodb/repositories/extended.repositories.js');
    const db = await getMongoDb();
    return { tournaments: await new TournamentRepository(db).listRecent(20) };
  });

  /** @openapi GET /api/v1/tournaments/:id — detail, rounds, standings. */
  app.get('/api/v1/tournaments/:id', async (req) => {
    const { id } = req.params as { id: string };
    const { tournamentDetail } = await import('../modules/tournaments/service.js');
    const { UserRepository } = await import('../database/mongodb/repositories/user.repository.js');
    const { getMongoDb } = await import('../database/mongodb/client.js');
    const detail = await tournamentDetail(id).catch(() => null);
    if (detail === null) throw new ValidationError('Tournament not found');
    const db = await getMongoDb().catch(() => null);
    const users = db === null ? null : new UserRepository(db);
    const nameOf = async (uid: string | null): Promise<string | null> => {
      if (uid === null || users === null) return uid;
      if (!/^[0-9a-fA-F]{24}$/.test(uid)) return uid;
      return (await users.findById(uid).catch(() => null))?.username ?? uid.slice(0, 8);
    };
    return {
      tournament: detail.tournament,
      players: await Promise.all(detail.players.map(async (uid) => ({ id: uid, username: await nameOf(uid) }))),
      rounds: detail.rounds,
      standings: await Promise.all(detail.standings.map(async (s) => ({ ...s, username: await nameOf(s.userId) }))),
    };
  });

  /** @openapi POST /api/v1/tournaments/:id/join — enter. */
  app.post('/api/v1/tournaments/:id/join', async (req) => {
    const userId = await requireUserId(req);
    const { id } = req.params as { id: string };
    const { joinTournament } = await import('../modules/tournaments/service.js');
    try {
      await joinTournament(id, userId);
    } catch (err) {
      throw new ValidationError(err instanceof Error ? err.message : 'Join failed');
    }
    return { ok: true };
  });

  /** @openapi POST /api/v1/tournaments/:id/open — open entries (owner). */
  app.post('/api/v1/tournaments/:id/open', async (req) => {
    const userId = await requireUserId(req);
    const { id } = req.params as { id: string };
    const { getMongoDb } = await import('../database/mongodb/client.js');
    const { TournamentRepository } = await import('../database/mongodb/repositories/extended.repositories.js');
    const { openTournament } = await import('../modules/tournaments/service.js');
    const db = await getMongoDb();
    const t = await new TournamentRepository(db).findById(id);
    if (t === null) throw new ValidationError('Tournament not found');
    if (t.ownerId !== userId) throw new ValidationError('Only the organizer can open entries');
    try {
      await openTournament(id);
    } catch (err) {
      throw new ValidationError(err instanceof Error ? err.message : 'Open failed');
    }
    return { ok: true };
  });

  /** @openapi POST /api/v1/tournaments/:id/start — seed round 1 (owner). */
  app.post('/api/v1/tournaments/:id/start', async (req) => {
    const userId = await requireUserId(req);
    const { id } = req.params as { id: string };
    const { getMongoDb } = await import('../database/mongodb/client.js');
    const { TournamentRepository } = await import('../database/mongodb/repositories/extended.repositories.js');
    const { startTournament } = await import('../modules/tournaments/service.js');
    const db = await getMongoDb();
    const t = await new TournamentRepository(db).findById(id);
    if (t === null) throw new ValidationError('Tournament not found');
    if (t.ownerId !== userId) throw new ValidationError('Only the organizer can start');
    try {
      await startTournament(id);
    } catch (err) {
      throw new ValidationError(err instanceof Error ? err.message : 'Start failed');
    }
    return { ok: true };
  });

  /** @openapi POST /api/v1/tournaments/:id/arena-play — queue for an arena pairing. */
  app.post('/api/v1/tournaments/:id/arena-play', async (req) => {
    const userId = await requireUserId(req);
    const { id } = req.params as { id: string };
    const { arenaPlay } = await import('../modules/tournaments/service.js');
    try {
      const res = await arenaPlay(id, userId);
      if (res.status === 'matched') {
        try {
          const { getMongoDb } = await import('../database/mongodb/client.js');
          const { NotificationRepository } = await import('../database/mongodb/repositories/extended.repositories.js');
          const db = await getMongoDb();
          await new NotificationRepository(db).create({
            userId, kind: 'match', title: 'Arena pairing found', body: res.gameId,
          }).catch(() => undefined);
        } catch {
          // notifications advisory
        }
      }
      return res;
    } catch (err) {
      throw new ValidationError(err instanceof Error ? err.message : 'Arena queue failed');
    }
  });

  /** @openapi POST /api/v1/tournaments/:id/finish — crown the leader (owner). */
  app.post('/api/v1/tournaments/:id/finish', async (req) => {
    const userId = await requireUserId(req);
    const { id } = req.params as { id: string };
    const { finishTournament } = await import('../modules/tournaments/service.js');
    try {
      await finishTournament(id, userId);
    } catch (err) {
      throw new ValidationError(err instanceof Error ? err.message : 'Finish failed');
    }
    return { ok: true };
  });

  /** @openapi POST /api/v1/tournaments/:id/report — report a match winner. */
  app.post('/api/v1/tournaments/:id/report', async (req) => {
    const userId = await requireUserId(req);
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as { round?: number; matchIndex?: number; winnerId?: string };
    if (typeof body.round !== 'number' || typeof body.matchIndex !== 'number' || typeof body.winnerId !== 'string') {
      throw new ValidationError('Invalid report');
    }
    const { reportResult } = await import('../modules/tournaments/service.js');
    try {
      await reportResult(id, body.round, body.matchIndex, body.winnerId, userId);
    } catch (err) {
      throw new ValidationError(err instanceof Error ? err.message : 'Report failed');
    }
    return { ok: true };
  });

  // ── Premium (entitlements; payments provider selects later) ──
  /** @openapi GET /api/v1/premium/status — tier + entitlements, honestly. Free preview open for now. */
  app.get('/api/v1/premium/status', async (req) => {
    const FREE_PREVIEW = true; // win-bar + review open to all until launch
    const cookies = (req as unknown as { cookies?: Record<string, string | undefined> }).cookies ?? {};
    const sid = getSessionId({ cookies, headers: req.headers });
    if (sid === null) {
      return { tier: 'free' as const, entitlements: FREE_PREVIEW ? ['AI_REVIEW_ADVANCED', 'REPLAY_ANALYTICS'] : [], payments: 'disabled' as const, reason: 'free preview open', freePreview: FREE_PREVIEW };
    }
    const me = await (await getAuthService()).me(sid).catch(() => null);
    if (me === null) {
      return { tier: 'free' as const, entitlements: FREE_PREVIEW ? ['AI_REVIEW_ADVANCED', 'REPLAY_ANALYTICS'] : [], payments: 'disabled' as const, reason: 'free preview open', freePreview: FREE_PREVIEW };
    }
    const { getMongoDb } = await import('../database/mongodb/client.js');
    const { EntitlementRepository } = await import('../database/mongodb/repositories/premium.repository.js');
    const db = await getMongoDb().catch(() => null);
    const entitlements = db === null ? [] : await new EntitlementRepository(db).list(me.id);
    const provider = (process.env['PAYMENT_PROVIDER'] ?? 'none').trim().toLowerCase();
    const { paymentStatus } = await import('../modules/payments/provider.js');
    const pay = paymentStatus();
    const effective = FREE_PREVIEW ? Array.from(new Set([...entitlements, 'AI_REVIEW_ADVANCED', 'REPLAY_ANALYTICS'])) : entitlements;
    return {
      tier: effective.length > 0 ? ('premium' as const) : ('free' as const),
      entitlements: effective,
      payments: (pay.checkoutReady ? 'stripe' : 'disabled') as 'stripe' | 'disabled',
      checkoutReady: pay.checkoutReady,
      freePreview: FREE_PREVIEW,
      reason: pay.checkoutReady ? pay.reason : provider === 'none'
        ? 'free preview open — win-bar + review accessible, entitlements granted by admins at launch'
        : `provider "${provider}" selected but checkout is not ready: ${pay.reason}`,
    };
  });

  // ── Premium + payments ─────────────────────────────
  /** @openapi POST /api/v1/premium/checkout — Stripe session when configured. */
  app.post('/api/v1/premium/checkout', async (req) => {
    const userId = await requireUserId(req);
    const { paymentStatus, createCheckoutSession } = await import('../modules/payments/provider.js');
    const status = paymentStatus();
    if (!status.checkoutReady) throw new ValidationError(status.reason);
    try {
      return await createCheckoutSession(userId);
    } catch (err) {
      throw new ValidationError(err instanceof Error ? err.message : 'Checkout failed');
    }
  });

  // Raw-body webhook context (signature verification needs exact bytes).
  await app.register(async (instance) => {
    instance.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
      (req as unknown as { rawBody?: string }).rawBody = typeof body === 'string' ? body : '';
      try {
        done(null, body === '' ? {} : JSON.parse(body as string));
      } catch (err) {
        done(err as Error);
      }
    });
    /** @openapi POST /api/v1/payments/webhook — Stripe events (verified). */
    instance.post('/api/v1/payments/webhook', async (req, reply) => {
      const { verifyStripeWebhook, applyStripeEvent } = await import('../modules/payments/provider.js');
      const raw = (req as unknown as { rawBody?: string }).rawBody ?? '';
      const sig = req.headers['stripe-signature'];
      const secret = process.env['STRIPE_WEBHOOK_SECRET'] ?? '';
      const event = verifyStripeWebhook(raw, typeof sig === 'string' ? sig : '', secret.replace(/PASTE_YOUR.*/, ''));
      if (event === null) {
        return reply.status(400).send({ ok: false, message: 'invalid signature' });
      }
      await applyStripeEvent(event);
      return { received: true };
    });
  });

  /** @openapi POST /api/v1/challenges — 1v1 direct challenge request. */
  app.post('/api/v1/challenges', async (req) => {
    const me = await requireUser(req);
    const userId = me.id;
    const body = (req.body ?? {}) as { username?: string; timeControl?: string; mode?: string };
    if (typeof body.username !== 'string' || body.username.trim().length < 2) throw new ValidationError('Pick a player');
    const timeControl = typeof body.timeControl === 'string' ? body.timeControl : '3+1';
    // Guest-involved challenges are always casual (GST-004 invite path).
    const senderGuest = me.guest;
    const mode = senderGuest ? 'casual' : body.mode === 'casual' ? 'casual' : 'ranked';
    try {
      const { getMongoDb } = await import('../database/mongodb/client.js');
      const { UserRepository } = await import('../database/mongodb/repositories/user.repository.js');
      const { NotificationRepository } = await import('../database/mongodb/repositories/extended.repositories.js');
      const { SettingsRepository } = await import('../database/mongodb/repositories/settings.repository.js');
      const db = await getMongoDb();
      const target = await new UserRepository(db).findByUsername(body.username.trim());
      if (target === null) throw new ValidationError('Player not found');
      if (target._id === userId) throw new ValidationError('Cannot challenge yourself');
      const prefs = await new SettingsRepository(db).get(target._id).catch(() => null);
      if (prefs !== null && !prefs.allowChallenges) throw new ValidationError('That player is not accepting challenges');
      const me = await new UserRepository(db).findById(userId).catch(() => null);
      await new NotificationRepository(db).create({
        userId: target._id, kind: 'challenge', title: `1v1 from ${me?.username ?? 'player'}`,
        body: JSON.stringify({ from: userId, fromUsername: me?.username ?? 'player', timeControl, mode }),
      });
      return { ok: true };
    } catch (err) {
      if (err instanceof ValidationError) throw err;
      throw new ValidationError('Challenge failed');
    }
  });

  // ── Notifications ────────────────────────────────────  /** @openapi GET /api/v1/notifications — my inbox, newest first. */
  app.get('/api/v1/notifications', async (req) => {
    const userId = await requireUserId(req);
    const { getMongoDb } = await import('../database/mongodb/client.js');
    const { NotificationRepository } = await import('../database/mongodb/repositories/extended.repositories.js');
    const db = await getMongoDb();
    const items = await new NotificationRepository(db).listForUser(userId, 30);
    return { notifications: items, unread: items.filter((n) => !n.read).length };
  });

  /** @openapi POST /api/v1/notifications/:id/read — mark one read. */
  app.post('/api/v1/notifications/:id/read', async (req) => {
    const userId = await requireUserId(req);
    const { id } = req.params as { id: string };
    const { getMongoDb } = await import('../database/mongodb/client.js');
    const { NotificationRepository } = await import('../database/mongodb/repositories/extended.repositories.js');
    const db = await getMongoDb();
    await new NotificationRepository(db).markRead(id, userId);
    return { ok: true };
  });

  // ── Search ───────────────────────────────────────────
  /** @openapi GET /api/v1/search — players, tournaments, clubs. */
  app.get('/api/v1/search', async (req) => {
    const q = req.query as { q?: string };
    const term = (typeof q.q === 'string' ? q.q : '').trim().slice(0, 24);
    if (term.length < 2) return { players: [], tournaments: [], clubs: [] };
    const { getMongoDb } = await import('../database/mongodb/client.js');
    const { UserRepository } = await import('../database/mongodb/repositories/user.repository.js');
    const { COLLECTIONS } = await import('../database/mongodb/collections.js');
    const { toDomainId } = await import('../database/mongodb/ids.js');
    const db = await getMongoDb();
    const users = await new UserRepository(db).search(term, 8);
    // Private profiles never appear in search (PRF-004).
    const { SettingsRepository } = await import('../database/mongodb/repositories/settings.repository.js');
    const settings = new SettingsRepository(db);
    const visibleUsers: typeof users = [];
    for (const u of users) {
      const prefs = await settings.get(u._id).catch(() => null);
      if (prefs !== null && prefs.profileVisibility === 'private') continue;
      visibleUsers.push(u);
    }
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const tours = await db.collection(COLLECTIONS.tournaments)
      .find({ title: { $regex: escaped, $options: 'i' } }).limit(8).toArray().catch(() => []);
    const clubs = await db.collection(COLLECTIONS.clubs)
      .find({ name: { $regex: escaped, $options: 'i' } }).limit(8).toArray().catch(() => []);
    return {
      players: visibleUsers.map((u) => ({ username: u.username })),
      tournaments: tours.map((t) => {
        const row = t as unknown as Record<string, unknown>;
        return { id: toDomainId(row['_id']), title: String(row['title'] ?? '') };
      }),
      clubs: clubs.map((c) => {
        const row = c as unknown as Record<string, unknown>;
        return { id: toDomainId(row['_id']), name: String(row['name'] ?? '') };
      }),
    };
  });

  /** @openapi GET /api/v1/announcements — active broadcasts. */
  app.get('/api/v1/announcements', async (req) => {
    const { getMongoDb } = await import('../database/mongodb/client.js');
    const { AnnouncementRepository } = await import('../database/mongodb/repositories/ops.repository.js');
    const db = await getMongoDb().catch(() => null);
    if (db === null) return { announcements: [] };
    const all = await new AnnouncementRepository(db).active();
    // Premium-targeted items need an entitlement; guests get the rest.
    const cookies = (req as unknown as { cookies?: Record<string, string | undefined> }).cookies ?? {};
    const sid = getSessionId({ cookies, headers: req.headers });
    let premium = false;
    if (sid !== null) {
      const me = await (await getAuthService()).me(sid).catch(() => null);
      if (me !== null) {
        const { EntitlementRepository } = await import('../database/mongodb/repositories/premium.repository.js');
        premium = (await new EntitlementRepository(db).list(me.id).catch(() => [])).length > 0;
      }
    }
    return { announcements: all.filter((a) => a.audience !== 'premium' || premium) };
  });

  /** @openapi POST /api/v1/analytics/event — product telemetry (authed). */
  app.post('/api/v1/analytics/event', async (req) => {
    const userId = await requireUserId(req);
    const body = (req.body ?? {}) as { name?: string; props?: Record<string, unknown> };
    if (typeof body.name !== 'string') throw new ValidationError('Invalid event');
    const { getMongoDb } = await import('../database/mongodb/client.js');
    const { trackEvent } = await import('../database/mongodb/repositories/ops.repository.js');
    const db = await getMongoDb().catch(() => null);
    if (db !== null) {
      const props = body.props !== undefined && typeof body.props === 'object' ? body.props : {};
      await trackEvent(db, userId, body.name, props);
    }
    return { ok: true };
  });

  /** @openapi POST /api/v1/reports — file a moderation report. */
  app.post('/api/v1/reports', async (req) => {
    const userId = await requireUserId(req);
    const body = (req.body ?? {}) as { targetType?: string; targetId?: string; reason?: string };
    if (body.targetType !== 'user' && body.targetType !== 'game' && body.targetType !== 'club') {
      throw new ValidationError('Invalid target type');
    }
    if (typeof body.targetId !== 'string' || typeof body.reason !== 'string') throw new ValidationError('Invalid report');
    const { ReportRepository } = await import('../database/mongodb/repositories/social.repository.js');
    const { getMongoDb } = await import('../database/mongodb/client.js');
    const db = await getMongoDb();
    try {
      const doc = await new ReportRepository(db).submit(userId, body.targetType, body.targetId, body.reason);
      return { ok: true, id: doc._id };
    } catch (err) {
      throw new ValidationError(err instanceof Error ? err.message : 'Report failed');
    }
  });

  /** @openapi POST /api/v1/presence/heartbeat — mark yourself online. */
  app.post('/api/v1/presence/heartbeat', async (req) => {
    const userId = await requireUserId(req);
    const { heartbeat } = await import('../modules/friends/service.js');
    await heartbeat(userId);
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
      const modes = ['bullet', 'blitz', 'rapid', 'classic', 'casual'] as const;
      const rows = await Promise.all(modes.map((m) => ratings.get(doc._id, m)));
      let viewer: string | null = null;
      try {
        viewer = await requireUserId(req);
      } catch {
        viewer = null;
      }
      const { SettingsRepository } = await import('../database/mongodb/repositories/settings.repository.js');
      const prefs = await new SettingsRepository(db).get(doc._id).catch(() => null);
      // Profile views: counted only after the privacy gate below, so
      // blocked attempts never inflate the numbers.
      let views = 0;
      let viewsWeek = 0;
      let viewsMonth = 0;
      // Profile + history visibility (PRF-004): private hides everything
      // from strangers; friends-only needs a confirmed friendship.
      let friendsVisible = false;
      if (viewer !== null && viewer !== doc._id) {
        try {
          const { FriendRepository } = await import('../database/mongodb/repositories/social.repository.js');
          friendsVisible = await new FriendRepository(db).areFriends(viewer, doc._id).catch(() => false);
        } catch {
          friendsVisible = false;
        }
      }
      const profileOpen = prefs === null || prefs.profileVisibility === 'public'
        || viewer === doc._id || (prefs.profileVisibility === 'friends' && friendsVisible);
      if (!profileOpen) throw new ValidationError('Player not found');
      const ratingsVisible = viewer === doc._id || prefs === null || prefs.showRating;
      try {
        const col = db.collection('users');
        await col.updateOne({ _id: doc._id as never }, { $inc: { profileViews: 1 } } as never).catch(() => undefined);
        const fresh = await users.findByUsername(username).catch(() => null);
        views = (fresh as unknown as { profileViews?: number } | null)?.profileViews ?? 0;
        const { COLLECTIONS } = await import('../database/mongodb/collections.js');
        const day = new Date().toISOString().slice(0, 10);
        const days = db.collection(COLLECTIONS.profile_view_days);
        await days.updateOne(
          { userId: doc._id, day },
          { $inc: { count: 1 }, $setOnInsert: { createdAt: new Date() } },
          { upsert: true },
        ).catch(() => undefined);
        const since = (n: number): string => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
        const sumSince = async (n: number): Promise<number> => {
          const bucket = await days.find({ userId: doc._id, day: { $gte: since(n) } }).toArray().catch(() => []);
          return bucket.reduce((s: number, r) => s + (typeof (r as Record<string, unknown>)['count'] === 'number' ? (r as Record<string, unknown>)['count'] as number : 0), 0);
        };
        viewsWeek = await sumSince(7).catch(() => 0);
        viewsMonth = await sumSince(30).catch(() => 0);
      } catch { views = 0; }
      const games = await new GameRepository(db).listByUser(doc._id, 50);
      const historyOpen = prefs === null || prefs.historyVisibility === 'public'
        || viewer === doc._id || (prefs.historyVisibility === 'friends' && friendsVisible);
      // Seat split + current form streak from finished games (newest first).
      // Hidden entirely when history visibility blocks the viewer.
      const finished = historyOpen ? games.filter((game) => game.status === 'FINISHED' && game.result !== undefined) : [];
      const seatWins: [number, number] = [0, 0];
      const seatGames: [number, number] = [0, 0];
      const outcomes: boolean[] = [];
      for (const game of finished) {
        const seat = game.players.find((p) => p.userId === doc._id)?.seat;
        if (seat !== 0 && seat !== 1) continue;
        seatGames[seat]++;
        const won = game.result?.winnerSeat === seat;
        if (won) seatWins[seat]++;
        outcomes.push(won);
      }
      let streak = 0;
      let streakWon = false;
      for (const won of outcomes) {
        if (streak === 0) {
          streakWon = won;
          streak = 1;
        } else if (won === streakWon) {
          streak++;
        } else {
          break;
        }
      }
      // Strategy/lifestyle metrics from finished docs (TRN-003): all data
      // already persisted, no invented personality claims.
      let timeouts = 0;
      let resignations = 0;
      let durationTotalSec = 0;
      let durationGames = 0;
      for (const game of finished) {
        if (game.result?.reason === 'timeout') timeouts++;
        if (game.result?.reason === 'resign') resignations++;
        if (game.finishedAt !== undefined && game.createdAt !== undefined) {
          const sec = Math.round((new Date(game.finishedAt).getTime() - new Date(game.createdAt).getTime()) / 1000);
          if (Number.isFinite(sec) && sec >= 0) {
            durationTotalSec += sec;
            durationGames++;
          }
        }
      }
      const wins = outcomes.filter(Boolean).length;
      const extended = {
        seatWins, seatGames, streak, streakWon,
        winRate: outcomes.length > 0 ? Math.round((wins / outcomes.length) * 1000) / 10 : 0,
        timeouts,
        resignations,
        avgDurationSec: durationGames > 0 ? Math.round(durationTotalSec / durationGames) : 0,
      };
      return {
        username: doc.username,
        joinedAt: doc.createdAt,
        views,
        viewsWeek,
        viewsMonth,
        frame: await (async () => {
          try {
            const { CosmeticsRepository } = await import('../database/mongodb/repositories/cosmetics.repository.js');
            return await new CosmeticsRepository(db).equippedFrame(doc._id);
          } catch {
            return 'frame-none';
          }
        })(),
        stats: extended,
        puzzles: await (async () => {
          try {
            const { PuzzleRepository } = await import('../database/mongodb/repositories/extended.repositories.js');
            const { userStreak } = await import('../modules/puzzles/service.js');
            const repo = new PuzzleRepository(db);
            const dates = await repo.solvedDates(doc._id).catch(() => [] as string[]);
            const { streak } = await userStreak(doc._id).catch(() => ({ streak: 0, solvedToday: false }));
            return { solves: dates.length, streak };
          } catch {
            return { solves: 0, streak: 0 };
          }
        })(),
        fairPlay: await (async () => {
          try {
            const { FairPlayRepository } = await import('../database/mongodb/repositories/fairplay.repository.js');
            const { conductLevel } = await import('../modules/fairplay/service.js');
            const rec = await new FairPlayRepository(db).get(doc._id);
            return { score: rec.score, level: conductLevel(rec.score) };
          } catch {
            return { score: 100, level: 'exemplary' as const };
          }
        })(),
        ratings: ratingsVisible ? modes.map((m, i) => ({
          mode: m,
          rating: rows[i]?.rating ?? defaultRating().rating,
          peak: rows[i]?.peak ?? defaultRating().rating,
          games: rows[i]?.games ?? 0,
          wins: rows[i]?.wins ?? 0,
          losses: rows[i]?.losses ?? 0,
        })) : [],
        recentGames: historyOpen ? games
          .filter((game) => game.visibility !== 'private' || viewer === doc._id || game.players.some((p) => p.userId === viewer))
          .map((game) => {
            const seat = game.players.find((p) => p.userId === doc._id)?.seat;
            const winnerSeat = game.result?.winnerSeat;
            return {
              id: game.engineId ?? game._id,
              mode: game.mode,
              timeControl: game.timeControl,
              status: game.status,
              result: game.result ?? null,
              // Viewer-relative outcome (null for live games / draws unknown).
              won: game.status === 'FINISHED' && typeof seat === 'number' && typeof winnerSeat === 'number'
                ? winnerSeat === seat
                : null,
              createdAt: game.createdAt,
            };
          }) : [],
      };
    } catch (err) {
      if (err instanceof ValidationError) throw err;
      // Offline dev: shape stays stable, values honestly empty.
      return { username, ratings: [], recentGames: [], degraded: true };
    }
  });

  /** @openapi GET /api/v1/profiles/:username/xp — level from real activity (PRF-006). */
  app.get('/api/v1/profiles/:username/xp', async (req) => {
    const { username } = req.params as { username: string };
    try {
      const { getMongoDb } = await import('../database/mongodb/client.js');
      const { UserRepository } = await import('../database/mongodb/repositories/user.repository.js');
      const { GameRepository } = await import('../database/mongodb/repositories/game.repository.js');
      const { COLLECTIONS } = await import('../database/mongodb/collections.js');
      const db = await getMongoDb();
      const user = await new UserRepository(db).findByUsername(username);
      if (user === null) throw new ValidationError('Player not found');
      // XP is DERIVED (never stored, never matchmade on): finished games,
      // solved puzzles, completed lessons. Formula is public and fixed.
      const games = await new GameRepository(db).listByUser(user._id, 500);
      const finishedGames = games.filter((g) => g.status === 'FINISHED').length;
      const puzzleSolves = await db.collection(COLLECTIONS.puzzle_attempts)
        .countDocuments({ userId: user._id, solved: true }).catch(() => 0);
      const lessons = await db.collection(COLLECTIONS.lesson_progress)
        .distinct('lessonId', { userId: user._id }).catch(() => []);
      const xp = finishedGames * 10 + puzzleSolves * 5 + lessons.length * 20;
      const level = Math.min(100, Math.floor(Math.sqrt(xp / 25)) + 1);
      return { username, xp, level, breakdown: { finishedGames, puzzleSolves, lessons: lessons.length } };
    } catch (err) {
      if (err instanceof ValidationError) throw err;
      return { username, xp: 0, level: 1, breakdown: { finishedGames: 0, puzzleSolves: 0, lessons: 0 }, degraded: true };
    }
  });

  /** @openapi GET /api/v1/profiles/:username/ratings/:mode/history — rating over time. */  app.get('/api/v1/profiles/:username/ratings/:mode/history', async (req) => {
    const { username, mode } = req.params as { username: string; mode: string };
    if (!['bullet', 'blitz', 'rapid', 'classic', 'casual'].includes(mode)) throw new ValidationError('Unknown mode');
    try {
      const { getMongoDb } = await import('../database/mongodb/client.js');
      const { UserRepository } = await import('../database/mongodb/repositories/user.repository.js');
      const { RatingRepository } = await import('../database/mongodb/repositories/rating.repository.js');
      const db = await getMongoDb();
      const user = await new UserRepository(db).findByUsername(username);
      if (user === null) throw new ValidationError('Player not found');
      const rows = await new RatingRepository(db).history(user._id, mode, 100);
      return {
        mode,
        points: rows.reverse().map((r) => ({ before: r.before, after: r.after, at: r.createdAt })),
      };
    } catch (err) {
      if (err instanceof ValidationError) throw err;
      return { mode, points: [], degraded: true };
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

  // ── Replays / review ───────────────────────────────
  /** @openapi GET /api/v1/replays/:gameId — deterministic replay payload. */
  app.get('/api/v1/replays/:gameId', async (req) => {
    const { gameId } = req.params as { gameId: string };
    const { canViewGame } = await import('../modules/games/access.js');
    const viewer = await (async () => {
      try {
        return await requireUserId(req);
      } catch {
        return null;
      }
    })();
    // Prefer the live record (freshest, includes in-progress games).
    try {
      const g = gamesService.get(gameId);
      try {
        const { getMongoDb } = await import('../database/mongodb/client.js');
        const db = await getMongoDb();
        if (!(await canViewGame(db, g, viewer))) throw new ValidationError('Replay not found');
      } catch (err) {
        if (err instanceof ValidationError) throw err;
        if (g.visibility !== 'public' && g.visibility !== 'unlisted') throw new ValidationError('Replay not found');
      }
      return {
        gameId,
        status: g.status,
        initialState: { size: g.state.size, wallsPerPlayer: g.state.wallsPerPlayer },
        rulesVersion: g.state.rulesVersion,
        actions: g.actions,
        result: g.status === 'finished' ? { winnerSeat: g.winnerSeat, reason: g.finishReason ?? 'goal' } : null,
      };
    } catch {
      // Fall through to the persisted replay.
    }
    try {
      const { getMongoDb } = await import('../database/mongodb/client.js');
      const { ReplayRepository } = await import('../database/mongodb/repositories/replay.repository.js');
      const db = await getMongoDb();
      const replay = await new ReplayRepository(db).findByGame(gameId);
      if (replay === null) throw new ValidationError('Replay not found');
      {
        const { GameRepository } = await import('../database/mongodb/repositories/game.repository.js');
        const doc = await new GameRepository(db).findByEngineId(gameId).catch(() => null);
        const playerIds = doc !== null ? doc.players.map((p) => p.userId) : [];
        if (!(await canViewGame(db, { visibility: replay.visibility ?? 'public', playerIds }, viewer))) {
          throw new ValidationError('Replay not found');
        }
      }
      return {
        gameId,
        status: 'FINISHED',
        initialState: replay.initialState,
        rulesVersion: replay.rulesVersion,
        actions: replay.actions,
        result: replay.result ?? null,
      };
    } catch (err) {
      if (err instanceof ValidationError) throw err;
      throw new ValidationError('Replay not found');
    }
  });

  /** @openapi GET /api/v1/games/:id/review — deterministic engine review. */
  app.get('/api/v1/games/:id/review', async (req) => {
    const { id } = req.params as { id: string };
    const { reviewGame } = await import('../../../engine/typescript/dist/review/index.js');
    const { canViewGame } = await import('../modules/games/access.js');
    const viewer = await (async () => {
      try {
        return await requireUserId(req);
      } catch {
        return null;
      }
    })();
    try {
      const g = gamesService.get(id);
      if (g.actions.length === 0) throw new ValidationError('No moves to review yet');
      try {
        const { getMongoDb } = await import('../database/mongodb/client.js');
        const db = await getMongoDb();
        if (!(await canViewGame(db, g, viewer))) throw new ValidationError('Nothing to review yet');
      } catch (err) {
        if (err instanceof ValidationError) throw err;
        if (g.visibility !== 'public' && g.visibility !== 'unlisted') throw new ValidationError('Nothing to review yet');
      }
      return {
        ...reviewGame(
          { size: g.state.size, wallsPerPlayer: g.state.wallsPerPlayer },
          g.actions,
        ),
        size: g.state.size,
        wallsPerPlayer: g.state.wallsPerPlayer,
      };
    } catch (err) {
      if (err instanceof ValidationError) throw err;
    }
    try {
      const { getMongoDb } = await import('../database/mongodb/client.js');
      const { ReplayRepository } = await import('../database/mongodb/repositories/replay.repository.js');
      const db = await getMongoDb();
      const replay = await new ReplayRepository(db).findByGame(id);
      if (replay === null || replay.actions.length === 0) throw new ValidationError('Nothing to review yet');
      {
        const { GameRepository } = await import('../database/mongodb/repositories/game.repository.js');
        const doc = await new GameRepository(db).findByEngineId(id).catch(() => null);
        const playerIds = doc !== null ? doc.players.map((p) => p.userId) : [];
        if (!(await canViewGame(db, { visibility: replay.visibility ?? 'public', playerIds }, viewer))) {
          throw new ValidationError('Nothing to review yet');
        }
      }
      const initial = replay.initialState as { size?: number; wallsPerPlayer?: number };
      const size = initial.size ?? 9;
      const wallsPerPlayer = initial.wallsPerPlayer ?? 10;
      return {
        ...reviewGame(
          { size, wallsPerPlayer },
          replay.actions as { type: 'move'; to: { r: number; c: number } }[] | { type: 'wall'; wall: { r: number; c: number; orientation: 'h' | 'v' } }[],
        ),
        size,
        wallsPerPlayer,
      };
    } catch (err) {
      if (err instanceof ValidationError) throw err;
      throw new ValidationError('Nothing to review yet');
    }
  });

  // ── Puzzles ────────────────────────────────────────
  /** @openapi GET /api/v1/puzzles/daily — today's wall puzzle (same for all). */
  app.get('/api/v1/puzzles/daily', async (req) => {
    const { getDailyPuzzleView, publicView, userStreak } = await import('../modules/puzzles/service.js');
    const { todayKey } = await import('../../../engine/typescript/dist/puzzles/index.js');
    const date = todayKey();
    const { puzzle, tasteSource } = await getDailyPuzzleView(date);
    // Auth optional: guests get the puzzle, members also get streak state.
    let streak = 0;
    let solvedToday = false;
    try {
      const userId = await requireUserId(req);
      const s = await userStreak(userId, date);
      streak = s.streak;
      solvedToday = s.solvedToday;
    } catch {
      // guest — puzzle stays fully playable
    }
    return { ...publicView(puzzle, tasteSource), streak, solvedToday };
  });

  /** @openapi GET /api/v1/puzzles/mine — blunders from your own games. */
  app.get('/api/v1/puzzles/mine', async (req) => {
    const userId = await requireUserId(req);
    const { myMistakes } = await import('../modules/puzzles/service.js');
    return { puzzles: await myMistakes(userId) };
  });

  /** @openapi POST /api/v1/puzzles/mine/attempt — answer a personal puzzle. */
  app.post('/api/v1/puzzles/mine/attempt', async (req) => {
    const userId = await requireUserId(req);
    const body = (req.body ?? {}) as { gameId?: string; seq?: number; action?: unknown };
    if (typeof body.gameId !== 'string' || typeof body.seq !== 'number') throw new ValidationError('Invalid attempt');
    const { GameActionSchema } = await import('../common/validation/schemas.js');
    const parsed = GameActionSchema.safeParse(body.action);
    if (!parsed.success) throw new ValidationError('Invalid action');
    const { attemptMine } = await import('../modules/puzzles/service.js');
    try {
      return await attemptMine(userId, body.gameId, body.seq, parsed.data);
    } catch (err) {
      throw new ValidationError(err instanceof Error ? err.message : 'Attempt failed');
    }
  });

  /** @openapi GET /api/v1/puzzles/rush/next — deterministic rush puzzle. */
  app.get('/api/v1/puzzles/rush/next', async (req) => {
    const q = req.query as { i?: string };
    const index = Math.min(Math.max(Number(q.i ?? 0) || 0, 0), 500);
    const { seededPuzzle, todayKey } = await import('../../../engine/typescript/dist/puzzles/index.js');
    const { publicView } = await import('../modules/puzzles/service.js');
    const date = todayKey();
    let lastErr: unknown = null;
    for (let k = 0; k < 6; k++) {
      const seed = `rush-${date}-${index}-${k}`;
      try {
        return { ...publicView(seededPuzzle(seed, seed, date)), seed };
      } catch (err) {
        lastErr = err;
      }
    }
    throw new ValidationError(lastErr instanceof Error ? lastErr.message : 'No rush puzzle available');
  });

  /** @openapi POST /api/v1/puzzles/rush/attempt — solve a rush puzzle. */
  app.post('/api/v1/puzzles/rush/attempt', async (req) => {
    const userId = await requireUserId(req);
    const body = (req.body ?? {}) as { seed?: string; wall?: unknown };
    if (typeof body.seed !== 'string' || body.seed.length > 120) throw new ValidationError('Invalid rush seed');
    const { WallSchema } = await import('../common/validation/schemas.js');
    const parsed = WallSchema.safeParse(body.wall);
    if (!parsed.success) throw new ValidationError('Invalid wall');
    const { seededPuzzle, gradeAttempt, todayKey } = await import('../../../engine/typescript/dist/puzzles/index.js');
    const date = todayKey();
    let puzzle;
    try {
      puzzle = seededPuzzle(body.seed, body.seed, date);
    } catch {
      throw new ValidationError('Unknown rush puzzle');
    }
    const verdict = gradeAttempt(puzzle, parsed.data);
    if (verdict.solved) {
      // Record solves only (failures are client-side strikes); unique per
      // (seed, user) keeps farming the same puzzle pointless.
      try {
        const { getMongoDb } = await import('../database/mongodb/client.js');
        const { COLLECTIONS } = await import('../database/mongodb/collections.js');
        const db = await getMongoDb();
        await db.collection(COLLECTIONS.rush_solves).updateOne(
          { seed: body.seed, userId },
          { $setOnInsert: { seed: body.seed, userId, gain: verdict.gain, date, createdAt: new Date() } },
          { upsert: true },
        );
      } catch {
        // solves are advisory for the run; the verdict stands
      }
    }
    return { solved: verdict.solved, gain: verdict.gain, need: verdict.need, legal: verdict.legal };
  });

  /** @openapi GET /api/v1/puzzles/rush/stats — my solves + leaders. */
  app.get('/api/v1/puzzles/rush/stats', async (req) => {
    const { getMongoDb } = await import('../database/mongodb/client.js');
    const { COLLECTIONS } = await import('../database/mongodb/collections.js');
    const { todayKey } = await import('../../../engine/typescript/dist/puzzles/index.js');
    const db = await getMongoDb().catch(() => null);
    if (db === null) return { mine: 0, today: 0, leaders: [] };
    const cookies = (req as unknown as { cookies?: Record<string, string | undefined> }).cookies ?? {};
    const sid = getSessionId({ cookies, headers: req.headers });
    let mine = 0;
    let today = 0;
    if (sid !== null) {
      const me = await (await getAuthService()).me(sid).catch(() => null);
      if (me !== null) {
        mine = await db.collection(COLLECTIONS.rush_solves).countDocuments({ userId: me.id });
        today = await db.collection(COLLECTIONS.rush_solves).countDocuments({ userId: me.id, date: todayKey() });
      }
    }
    const top = (await db.collection(COLLECTIONS.rush_solves).aggregate([
      { $group: { _id: '$userId', solves: { $sum: 1 } } },
      { $sort: { solves: -1 } },
      { $limit: 10 },
    ]).toArray().catch(() => [])) as { _id: string; solves: number }[];
    const { UserRepository } = await import('../database/mongodb/repositories/user.repository.js');
    const users = new UserRepository(db);
    const leaders = await Promise.all(top.map(async (t, i) => ({
      rank: i + 1,
      username: (await users.findById(t._id).catch(() => null))?.username ?? t._id.slice(0, 8),
      solves: t.solves,
    })));
    return { mine, today, leaders };
  });

  // ── Learn ────────────────────────────────────────────
  /** @openapi GET /api/v1/learn/curriculum — lessons + progress. */
  app.get('/api/v1/learn/curriculum', async (req) => {
    const { CURRICULUM } = await import('../modules/learn/curriculum.js');
    const { progress } = await import('../modules/learn/service.js');
    const cookies = (req as unknown as { cookies?: Record<string, string | undefined> }).cookies ?? {};
    const sid = getSessionId({ cookies, headers: req.headers });
    let done: Record<string, string[]> = {};
    if (sid !== null) {
      const me = await (await getAuthService()).me(sid).catch(() => null);
      if (me !== null) done = await progress(me.id);
    }
    return {
      lessons: CURRICULUM.map((l) => ({
        id: l.id,
        title: l.title,
        description: l.description,
        steps: l.steps.map((s) => ({
          id: s.id,
          title: s.title,
          explain: s.explain,
          size: s.size,
          wallsPerPlayer: s.wallsPerPlayer,
          turn: s.turn,
          pawns: s.pawns,
          walls: s.walls,
          wallsRemaining: s.wallsRemaining,
          task: s.task,
          needGain: s.needGain ?? null,
          solved: (done[l.id] ?? []).includes(s.id),
        })),
      })),
    };
  });

  /** @openapi POST /api/v1/learn/attempt — solve a lesson step. */
  app.post('/api/v1/learn/attempt', async (req) => {
    const userId = await requireUserId(req);
    const body = (req.body ?? {}) as { lessonId?: string; stepId?: string; action?: unknown };
    if (typeof body.lessonId !== 'string' || typeof body.stepId !== 'string') throw new ValidationError('Invalid attempt');
    const { GameActionSchema } = await import('../common/validation/schemas.js');
    const parsed = GameActionSchema.safeParse(body.action);
    if (!parsed.success) throw new ValidationError('Invalid action');
    const { findStep } = await import('../modules/learn/curriculum.js');
    const { gradeStep, recordSolved } = await import('../modules/learn/service.js');
    const found = findStep(body.lessonId, body.stepId);
    if (found === null) throw new ValidationError('Unknown lesson step');
    const result = gradeStep(found.step, parsed.data);
    if (result.solved) await recordSolved(userId, body.lessonId, body.stepId);
    return result;
  });

  /** @openapi GET /api/v1/learn/openings — mined opening book. */
  app.get('/api/v1/learn/openings', async () => {
    const { OPENING_BOOK } = await import('../modules/learn/openings.js');
    return OPENING_BOOK;
  });

  /** @openapi GET /api/v1/nemesis — my counter-strategy profile. */
  app.get('/api/v1/nemesis', async (req) => {
    const userId = await requireUserId(req);
    const { nemesisFor } = await import('../modules/nemesis/service.js');
    return nemesisFor(userId);
  });

  /** @openapi GET /api/v1/mirror — my style profile (play like me). */
  app.get('/api/v1/mirror', async (req) => {
    const userId = await requireUserId(req);
    const { mirrorFor } = await import('../modules/mirror/service.js');
    return mirrorFor(userId);
  });

  /** @openapi GET /api/v1/ghost/games — my finished games raceable as ghosts. */
  app.get('/api/v1/ghost/games', async (req) => {
    const userId = await requireUserId(req);
    const { getMongoDb } = await import('../database/mongodb/client.js');
    const { GameRepository } = await import('../database/mongodb/repositories/game.repository.js');
    const { ReplayRepository } = await import('../database/mongodb/repositories/replay.repository.js');
    const db = await getMongoDb();
    const docs = await new GameRepository(db).listByUser(userId, 20);
    const replays = new ReplayRepository(db);
    const out: { gameId: string; timeControl: string; moves: number; result: string | null; createdAt: unknown }[] = [];
    for (const g of docs) {
      if (g.status !== 'FINISHED') continue;
      const replay = await replays.findByGame(g.engineId ?? g._id).catch(() => null);
      if (replay === null || replay.actions.length < 10) continue;
      const seat = g.players.find((p) => p.userId === userId)?.seat ?? null;
      out.push({
        gameId: g.engineId ?? g._id,
        timeControl: g.timeControl,
        moves: replay.actions.length,
        result: seat === null || g.result?.winnerSeat === undefined || g.result.winnerSeat === null
          ? 'draw'
          : g.result.winnerSeat === seat ? 'win' : 'loss',
        createdAt: g.createdAt,
      });
      if (out.length >= 10) break;
    }
    return { games: out };
  });

  /** @openapi GET /api/v1/ghost/games/:id — ghost action script (my game only). */
  app.get('/api/v1/ghost/games/:id', async (req) => {
    const userId = await requireUserId(req);
    const { id } = req.params as { id: string };
    const { getMongoDb } = await import('../database/mongodb/client.js');
    const { GameRepository } = await import('../database/mongodb/repositories/game.repository.js');
    const { ReplayRepository } = await import('../database/mongodb/repositories/replay.repository.js');
    const db = await getMongoDb();
    const doc = await new GameRepository(db).findByEngineId(id).catch(() => null);
    if (doc === null || !doc.players.some((p) => p.userId === userId)) {
      throw new ValidationError('Ghost not found');
    }
    const replay = await new ReplayRepository(db).findByGame(id).catch(() => null);
    if (replay === null || replay.actions.length === 0) throw new ValidationError('Ghost not found');
    const initial = replay.initialState as { size?: number; wallsPerPlayer?: number };
    return {
      gameId: id,
      size: initial.size ?? 9,
      wallsPerPlayer: initial.wallsPerPlayer ?? 10,
      actions: replay.actions,
    };
  });

  /** @openapi POST /api/v1/puzzles/daily/attempt — submit a wall. */
  app.post('/api/v1/puzzles/daily/attempt', async (req) => {
    const userId = await requireUserId(req);
    const { WallSchema } = await import('../common/validation/schemas.js');
    const parsed = WallSchema.safeParse((req.body as Record<string, unknown>)?.['wall'] ?? req.body);
    if (!parsed.success) throw new ValidationError('Invalid wall');
    const { attemptDaily } = await import('../modules/puzzles/service.js');
    return attemptDaily(userId, parsed.data);
  });

  /** @openapi GET /api/v1/puzzles/multi/daily — today's party choke (same for all). */
  app.get('/api/v1/puzzles/multi/daily', async () => {
    const { multiPuzzleDaily } = await import('../../../engine/typescript/dist/multi/index.js');
    const { todayKey, difficultyOf } = await import('../../../engine/typescript/dist/puzzles/index.js');
    const date = todayKey();
    const full = multiPuzzleDaily(date, 4);
    const { solution: _solution, ...publicPuzzle } = full;
    // Uniqueness is not graded for party positions, so cap at tricky/classic.
    return { ...publicPuzzle, difficulty: difficultyOf(full.solutionGain, 0), streak: 0, solvedToday: false };
  });

  /** @openapi POST /api/v1/puzzles/multi/attempt — submit a party wall. */
  app.post('/api/v1/puzzles/multi/attempt', async (req) => {
    const userId = await requireUserId(req);
    const { WallSchema } = await import('../common/validation/schemas.js');
    const parsed = WallSchema.safeParse((req.body as Record<string, unknown>)?.['wall'] ?? req.body);
    if (!parsed.success) throw new ValidationError('Invalid wall');
    const { multiPuzzleDaily, gradeMultiAttempt } = await import('../../../engine/typescript/dist/multi/index.js');
    const { todayKey } = await import('../../../engine/typescript/dist/puzzles/index.js');
    const date = todayKey();
    const full = multiPuzzleDaily(date, 4);
    const verdict = gradeMultiAttempt(full, parsed.data);
    if (verdict.legal) {
      try {
        const { getMongoDb } = await import('../database/mongodb/client.js');
        const { PuzzleRepository } = await import('../database/mongodb/repositories/extended.repositories.js');
        const db = await getMongoDb();
        await new PuzzleRepository(db).recordAttempt(userId, full.puzzleId, verdict.solved);
      } catch {
        // attempts advisory; verdict stands
      }
    }
    return { ...verdict, solution: verdict.solved ? full.solution : undefined };
  });

  /** Premium gate: any entitlement counts (free users get a clear 403). */
  async function requirePremiumId(req: FastifyRequest): Promise<string> {
    const userId = await requireUserId(req);
    const { getMongoDb } = await import('../database/mongodb/client.js');
    const { EntitlementRepository } = await import('../database/mongodb/repositories/premium.repository.js');
    const db = await getMongoDb();
    const list = await new EntitlementRepository(db).list(userId).catch(() => []);
    if (list.length === 0) throw new ValidationError('Premium puzzle pack needs a premium subscription');
    return userId;
  }

  /** @openapi GET /api/v1/puzzles/premium/pack — today's 100-puzzle premium pack (cached). */
  app.get('/api/v1/puzzles/premium/pack', async (req) => {
    const userId = await requirePremiumId(req);
    const { getPremiumPack } = await import('../modules/puzzles/service.js');
    const { todayKey } = await import('../../../engine/typescript/dist/puzzles/index.js');
    return getPremiumPack(userId, todayKey());
  });

  /** @openapi POST /api/v1/puzzles/premium/attempt — submit a pack wall. */
  app.post('/api/v1/puzzles/premium/attempt', async (req) => {
    const userId = await requirePremiumId(req);
    const { WallSchema } = await import('../common/validation/schemas.js');
    const body = (req.body ?? {}) as { index?: unknown; wall?: unknown };
    const index = typeof body.index === 'number' ? body.index : -1;
    if (!Number.isInteger(index) || index < 0 || index >= 100) throw new ValidationError('Invalid pack index');
    const parsed = WallSchema.safeParse(body.wall);
    if (!parsed.success) throw new ValidationError('Invalid wall');
    const { attemptPremium } = await import('../modules/puzzles/service.js');
    const { todayKey } = await import('../../../engine/typescript/dist/puzzles/index.js');
    return attemptPremium(userId, index, parsed.data, todayKey());
  });

  /** @openapi GET /api/v1/stats/public — headline counters (cached 60s, no auth). */
  app.get('/api/v1/stats/public', async () => {
    const { getMongoDb } = await import('../database/mongodb/client.js');
    const now = Date.now();
    if (publicStatsCache !== null && now - publicStatsCache.at < 60_000) return publicStatsCache.body;
    try {
      const db = await getMongoDb();
      const dayStart = new Date();
      dayStart.setUTCHours(0, 0, 0, 0);
      const [users, gamesToday] = await Promise.all([
        db.collection('users').countDocuments({}).catch(() => 0),
        db.collection('games').countDocuments({ createdAt: { $gte: dayStart } }).catch(() => 0),
      ]);
      const body = { users, gamesToday };
      publicStatsCache = { at: now, body };
      return body;
    } catch {
      return { users: 0, gamesToday: 0 };
    }
  });

  /** @openapi GET /api/v1/ai/coach-summary/:gameId — whole-game AI narrative. */
  app.get('/api/v1/ai/coach-summary/:gameId', async (req) => {
    const userId = await requireUserId(req);
    const { gameId } = req.params as { gameId: string };
    const provider = activeProvider();
    if (provider === null) {
      return {
        available: false as const,
        message: 'Coach is not configured on this deployment. The engine review above is still available.',
      };
    }
    const rev = await import('../../../engine/typescript/dist/review/index.js');
    let actions: { type: 'move'; to: { r: number; c: number } }[] | { type: 'wall'; wall: { r: number; c: number; orientation: 'h' | 'v' } }[] = [];
    let size = 9;
    let wallsPerPlayer = 10;
    let winnerSeat: number | null = null;
    try {
      const g = gamesService.get(gameId);
      actions = g.actions as typeof actions;
      size = g.state.size;
      wallsPerPlayer = g.state.wallsPerPlayer;
      winnerSeat = g.winnerSeat;
    } catch {
      const { getMongoDb } = await import('../database/mongodb/client.js');
      const { ReplayRepository } = await import('../database/mongodb/repositories/replay.repository.js');
      const db = await getMongoDb();
      const replay = await new ReplayRepository(db).findByGame(gameId);
      if (replay === null) throw new ValidationError('Game not found');
      actions = replay.actions as typeof actions;
      const initial = replay.initialState as { size?: number; wallsPerPlayer?: number };
      size = initial.size ?? 9;
      wallsPerPlayer = initial.wallsPerPlayer ?? 10;
      winnerSeat = replay.result?.winnerSeat ?? null;
    }
    if (actions.length === 0) throw new ValidationError('Nothing to summarize yet');
    const review = rev.reviewGame({ size, wallsPerPlayer }, actions, 7, { wallCandidates: 12, budgetMs: 30 });
    const count = (cls: string, p: 0 | 1): number =>
      review.moves.filter((m) => m.by === p && (m.class === cls || (cls === 'BLUNDER' && m.class === 'MISTAKE'))).length;
    let biggestSwing = 0;
    for (let i = 1; i < review.evalCurve.length; i++) {
      const swing = Math.abs((review.evalCurve[i] as number) - (review.evalCurve[i - 1] as number));
      if (swing > biggestSwing) biggestSwing = swing;
    }
    const { coachGameSummary } = await import('../modules/ai/complete.js');
    const result = await coachGameSummary(userId, provider.id, {
      moves: actions.length,
      winnerSeat,
      accuracy: review.summary.accuracy,
      blunders: [count('BLUNDER', 0), count('BLUNDER', 1)],
      brilliants: [
        review.moves.filter((m) => m.by === 0 && m.class === 'BRILLIANT').length,
        review.moves.filter((m) => m.by === 1 && m.class === 'BRILLIANT').length,
      ],
      biggestSwing,
    });
    if (!result.ok) {
      return { available: false as const, provider: result.provider ?? provider.id, message: result.error ?? 'Coach unavailable' };
    }
    return { available: true as const, provider: result.provider, explanation: result.explanation };
  });

  /** @openapi POST /api/v1/ai/commentate — live play-by-play for a game. */
  app.post('/api/v1/ai/commentate', async (req) => {
    const userId = await requireUserId(req);
    const body = (req.body ?? {}) as { gameId?: string };
    if (typeof body.gameId !== 'string') throw new ValidationError('Invalid request');
    const provider = activeProvider();
    if (provider === null) {
      return {
        available: false as const,
        message: 'AI commentary is not configured on this deployment.',
      };
    }
    type Ply = { type: 'move'; to: { r: number; c: number } } | { type: 'wall'; wall: { r: number; c: number; orientation: 'h' | 'v' } };
    let full: Ply[] = [];
    let size = 9;
    let wallsPerPlayer = 10;
    let status = 'unknown';
    let winnerSeat: number | null = null;
    let clockSec: [number, number] = [0, 0];
    let turn: 0 | 1 = 0;
    try {
      const g = gamesService.get(body.gameId);
      full = g.actions as Ply[];
      size = g.state.size;
      wallsPerPlayer = g.state.wallsPerPlayer;
      status = g.status;
      winnerSeat = g.winnerSeat;
      turn = g.state.turn;
      clockSec = [Math.ceil(g.clock.remainingMs[0] / 1000), Math.ceil(g.clock.remainingMs[1] / 1000)];
    } catch {
      const { getMongoDb } = await import('../database/mongodb/client.js');
      const { ReplayRepository } = await import('../database/mongodb/repositories/replay.repository.js');
      const db = await getMongoDb();
      const replay = await new ReplayRepository(db).findByGame(body.gameId);
      if (replay === null) throw new ValidationError('Game not found');
      full = (replay.actions ?? []) as Ply[];
      const initial = replay.initialState as { size?: number; wallsPerPlayer?: number };
      size = initial.size ?? 9;
      wallsPerPlayer = initial.wallsPerPlayer ?? 10;
      status = 'FINISHED';
      winnerSeat = replay.result?.winnerSeat ?? null;
    }
    // Reconstruct current paths from the action list (capped for sanity).
    let ownPath = -1;
    let oppPath = -1;
    try {
      const rules = await import('../../../engine/typescript/dist/rules/game.js');
      const bfs = await import('../../../engine/typescript/dist/pathfinding/bfs.js');
      const { state } = rules.replayGame({ size, wallsPerPlayer }, full.slice(0, 300));
      ownPath = bfs.findShortestPath(state, 0).length;
      oppPath = bfs.findShortestPath(state, 1).length;
      turn = state.turn;
    } catch {
      // paths stay unknown; the model is told only what we verified
    }
    const recent = full.slice(-8);
    const lastActions = recent.map((a) => (a.type === 'move' ? `move ${a.to.r},${a.to.c}` : `wall ${a.wall.orientation} ${a.wall.r},${a.wall.c}`));
    const { commentate } = await import('../modules/ai/complete.js');
    const result = await commentate(userId, provider.id, {
      moves: full.length,
      turn,
      status,
      lastActions,
      ownPath,
      oppPath,
      clockSec,
      winnerSeat,
    });
    if (!result.ok) {
      return { available: false as const, provider: result.provider ?? provider.id, message: result.error ?? 'Commentary unavailable' };
    }
    return { available: true as const, provider: result.provider, commentary: result.explanation };
  });

  // ── AI (optional providers, graceful when unconfigured) ──
  /** @openapi GET /api/v1/ai/status — provider availability (no secrets). */
  app.get('/api/v1/ai/status', async () => ({
    providers: providerStatuses(),
    active: activeProvider(),
  }));

  /** @openapi POST /api/v1/ai/coach — explain engine facts (live when configured). */
  app.post('/api/v1/ai/coach', async (req) => {
    const userId = await requireUserId(req);
    const parsed = CoachRequestSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw new ValidationError('Invalid coach request');
    const provider = activeProvider();
    if (provider === null) {
      return {
        available: false as const,
        message: 'Coach is not configured on this deployment. Post-game engine analysis below is still available.',
      };
    }
    const { coachExplanation } = await import('../modules/ai/complete.js');
    const result = await coachExplanation(userId, provider.id, parsed.data);
    if (!result.ok) {
      return { available: false as const, provider: result.provider ?? provider.id, message: result.error ?? 'Coach unavailable' };
    }
    return { available: true as const, provider: result.provider, explanation: result.explanation };
  });
}
