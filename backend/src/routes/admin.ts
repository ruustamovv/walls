/**
 * Owner control center API. Every route requires admin power; every
 * mutation appends an audit entry. Reads need moderator, writes need admin,
 * bans need admin.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ValidationError } from '../common/errors/errors.js';
import { audit, requireRole } from '../modules/admin/rbac.js';

const StatusSchema = z.object({ status: z.enum(['ACTIVE', 'SUSPENDED', 'BANNED']) });
const FlagSchema = z.object({ key: z.string().min(1).max(64), enabled: z.boolean() });

export async function registerAdmin(app: FastifyInstance): Promise<void> {
  /** @openapi GET /api/v1/admin/overview — platform vitals. */
  app.get('/api/v1/admin/overview', async (req) => {
    await requireRole(req, 'moderator');
    const { getMongoDb } = await import('../database/mongodb/client.js');
    const { checkRedisHealth } = await import('../database/redis/health.js');
    const { gamesService } = await import('../modules/games/service.js');
    const db = await getMongoDb();
    const [users, games, ratings, replays, tournaments, clubs, reportsOpen, redis] = await Promise.all([
      db.collection('users').countDocuments({}),
      db.collection('games').countDocuments({}),
      db.collection('ratings').countDocuments({}),
      db.collection('replays').countDocuments({}),
      db.collection('tournaments').countDocuments({}),
      db.collection('clubs').countDocuments({}),
      db.collection('reports').countDocuments({ status: 'OPEN' }),
      checkRedisHealth(),
    ]);
    const { monthlySpendUsd } = await import('../modules/ai/complete.js');
    const aiBudget = Number(process.env['AI_MONTHLY_BUDGET_USD'] ?? 25);
    return {
      users,
      aiBudget: Number.isFinite(aiBudget) ? aiBudget : 25,
      aiSpendUsd: Math.round((await monthlySpendUsd().catch(() => 0)) * 10000) / 10000,
      games: { total: games, liveInMemory: gamesService.listActive(1000).length },
      ratings,
      replays,
      tournaments,
      clubs,
      reportsOpen,
      redis: redis.ok ? 'OK' : 'DEGRADED',
      queueNote: 'matchmaking depth is per-instance unless Redis queue is active',
    };
  });

  /** @openapi GET /api/v1/admin/users — prefix search. */
  app.get('/api/v1/admin/users', async (req) => {
    const me = await requireRole(req, 'moderator');
    const q = req.query as { search?: string };
    const { getMongoDb } = await import('../database/mongodb/client.js');
    const { UserRepository } = await import('../database/mongodb/repositories/user.repository.js');
    const db = await getMongoDb();
    const rows = await new UserRepository(db).search(typeof q.search === 'string' ? q.search : '', 20);
    await audit(me.id, 'admin.users.search', undefined, { search: q.search ?? '' });
    return {
      users: rows.map((u) => ({
        id: u._id, username: u.username, email: u.email,
        role: u.role, status: u.status, createdAt: u.createdAt,
      })),
    };
  });

  /** @openapi GET /api/v1/admin/users/:id — identity + ratings + games. */
  app.get('/api/v1/admin/users/:id', async (req) => {
    await requireRole(req, 'moderator');
    const { id } = req.params as { id: string };
    const { getMongoDb } = await import('../database/mongodb/client.js');
    const { UserRepository } = await import('../database/mongodb/repositories/user.repository.js');
    const { RatingRepository } = await import('../database/mongodb/repositories/rating.repository.js');
    const { GameRepository } = await import('../database/mongodb/repositories/game.repository.js');
    const db = await getMongoDb();
    const user = await new UserRepository(db).findById(id);
    if (user === null) throw new ValidationError('User not found');
    const ratings = new RatingRepository(db);
    const modes = ['bullet', 'blitz', 'rapid', 'casual'] as const;
    const rows = await Promise.all(modes.map((m) => ratings.get(id, m)));
    const games = await new GameRepository(db).listByUser(id, 10);
    return {
      user: { id: user._id, username: user.username, email: user.email, role: user.role, status: user.status, createdAt: user.createdAt },
      ratings: modes.map((m, i) => ({ mode: m, rating: rows[i]?.rating ?? null, games: rows[i]?.games ?? 0 })),
      recentGames: games.map((g) => ({ id: g.engineId ?? g._id, status: g.status, result: g.result ?? null })),
    };
  });

  /** @openapi POST /api/v1/admin/users/:id/status — suspend/ban/restore. */
  app.post('/api/v1/admin/users/:id/status', async (req) => {
    const me = await requireRole(req, 'admin');
    const { id } = req.params as { id: string };
    const parsed = StatusSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw new ValidationError('Invalid status');
    const { getMongoDb } = await import('../database/mongodb/client.js');
    const { UserRepository } = await import('../database/mongodb/repositories/user.repository.js');
    const db = await getMongoDb();
    const ok = await new UserRepository(db).updateStatus(id, parsed.data.status);
    if (!ok) throw new ValidationError('User not found');
    await audit(me.id, `admin.users.${parsed.data.status.toLowerCase()}`, id);
    return { ok: true };
  });

  /** @openapi GET /api/v1/admin/games/recent — newest game docs. */
  app.get('/api/v1/admin/games/recent', async (req) => {
    await requireRole(req, 'moderator');
    const { getMongoDb } = await import('../database/mongodb/client.js');
    const { GameRepository } = await import('../database/mongodb/repositories/game.repository.js');
    const db = await getMongoDb();
    const rows = await new GameRepository(db).listRecent(25);
    return {
      games: rows.map((g) => ({
        id: g.engineId ?? g._id, mode: g.mode, timeControl: g.timeControl,
        status: g.status, result: g.result ?? null, moveCount: g.moveCount, createdAt: g.createdAt,
      })),
    };
  });

  /** @openapi GET /api/v1/admin/flags — feature flags. */
  app.get('/api/v1/admin/flags', async (req) => {
    await requireRole(req, 'moderator');
    const { getMongoDb } = await import('../database/mongodb/client.js');
    const { FlagRepository } = await import('../database/mongodb/repositories/social.repository.js');
    const db = await getMongoDb();
    return { flags: await new FlagRepository(db).list() };
  });

  /** @openapi PUT /api/v1/admin/flags — set a feature flag. */
  app.put('/api/v1/admin/flags', async (req) => {
    const me = await requireRole(req, 'admin');
    const parsed = FlagSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw new ValidationError('Invalid flag');
    const { getMongoDb } = await import('../database/mongodb/client.js');
    const { FlagRepository } = await import('../database/mongodb/repositories/social.repository.js');
    const db = await getMongoDb();
    const flag = await new FlagRepository(db).set(parsed.data.key, parsed.data.enabled);
    await audit(me.id, 'admin.flags.set', flag.key, { enabled: parsed.data.enabled });
    return { flag };
  });

  /** @openapi GET /api/v1/admin/entitlements — list a user's entitlements. */
  app.get('/api/v1/admin/entitlements', async (req) => {
    await requireRole(req, 'moderator');
    const q = req.query as { userId?: string };
    if (typeof q.userId !== 'string') throw new ValidationError('userId required');
    const { getMongoDb } = await import('../database/mongodb/client.js');
    const { EntitlementRepository } = await import('../database/mongodb/repositories/premium.repository.js');
    const db = await getMongoDb();
    return { userId: q.userId, entitlements: await new EntitlementRepository(db).list(q.userId) };
  });

  /** @openapi POST /api/v1/admin/entitlements/grant — grant premium access. */
  app.post('/api/v1/admin/entitlements/grant', async (req) => {
    const me = await requireRole(req, 'admin');
    const body = (req.body ?? {}) as { userId?: string; entitlement?: string };
    if (typeof body.userId !== 'string' || typeof body.entitlement !== 'string') throw new ValidationError('Invalid grant');
    const { getMongoDb } = await import('../database/mongodb/client.js');
    const { EntitlementRepository, isEntitlement } = await import('../database/mongodb/repositories/premium.repository.js');
    if (!isEntitlement(body.entitlement)) throw new ValidationError('Unknown entitlement');
    const db = await getMongoDb();
    await new EntitlementRepository(db).grant(body.userId, body.entitlement, `admin:${me.id}`);
    await audit(me.id, 'admin.entitlements.grant', body.userId, { entitlement: body.entitlement });
    return { ok: true };
  });

  /** @openapi POST /api/v1/admin/entitlements/revoke — remove premium access. */
  app.post('/api/v1/admin/entitlements/revoke', async (req) => {
    const me = await requireRole(req, 'admin');
    const body = (req.body ?? {}) as { userId?: string; entitlement?: string };
    if (typeof body.userId !== 'string' || typeof body.entitlement !== 'string') throw new ValidationError('Invalid revoke');
    const { getMongoDb } = await import('../database/mongodb/client.js');
    const { EntitlementRepository, isEntitlement } = await import('../database/mongodb/repositories/premium.repository.js');
    if (!isEntitlement(body.entitlement)) throw new ValidationError('Unknown entitlement');
    const db = await getMongoDb();
    await new EntitlementRepository(db).revoke(body.userId, body.entitlement);
    await audit(me.id, 'admin.entitlements.revoke', body.userId, { entitlement: body.entitlement });
    return { ok: true };
  });

  /** @openapi GET /api/v1/admin/stats — 7-day series + AI usage. */
  app.get('/api/v1/admin/stats', async (req) => {
    await requireRole(req, 'moderator');
    const { getMongoDb } = await import('../database/mongodb/client.js');
    const db = await getMongoDb();
    const since = new Date(Date.now() - 7 * 86400 * 1000);
    const perDay = async (collection: string): Promise<{ day: string; count: number }[]> => {
      const rows = (await db.collection(collection).aggregate([
        { $match: { createdAt: { $gte: since } } },
        { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, count: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ]).toArray().catch(() => [])) as { _id: string; count: number }[];
      return rows.map((r) => ({ day: r._id, count: r.count }));
    };
    const aiRows = (await db.collection('ai_usage').aggregate([
      { $match: { createdAt: { $gte: since } } },
      { $group: { _id: '$provider', requests: { $sum: 1 }, errors: { $sum: { $cond: ['$ok', 0, 1] } }, spend: { $sum: '$estimatedUsd' } } },
    ]).toArray().catch(() => [])) as { _id: string; requests: number; errors: number; spend: number }[];
    const events = (await db.collection('analytics_events').aggregate([
      { $match: { createdAt: { $gte: since } } },
      { $group: { _id: '$name', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 12 },
    ]).toArray().catch(() => [])) as { _id: string; count: number }[];
    return {
      usersPerDay: await perDay('users'),
      gamesPerDay: await perDay('games'),
      puzzlesPerDay: await perDay('puzzle_attempts'),
      aiUsage: aiRows.map((r) => ({
        provider: r._id ?? 'unknown', requests: r.requests, errors: r.errors,
        spendUsd: typeof r.spend === 'number' && Number.isFinite(r.spend) ? Math.round(r.spend * 10000) / 10000 : 0,
      })),
      topEvents: events.map((r) => ({ name: r._id ?? '?', count: r.count })),
    };
  });

  /** @openapi GET /api/v1/admin/queue — matchmaking depths + live games. */
  app.get('/api/v1/admin/queue', async (req) => {
    await requireRole(req, 'moderator');
    const { matchmakingDepths } = await import('./v1.js');
    const { gamesService } = await import('../modules/games/service.js');
    return {
      queue: await matchmakingDepths(),
      liveGames: gamesService.listActive(50).map((g) => ({
        id: g.id, mode: g.mode, timeControl: g.timeControlId, moveCount: g.actions.length,
        seats: g.playerIds, updatedAt: g.updatedAt,
      })),
    };
  });

  /** @openapi GET /api/v1/admin/reports — moderation queue. */
  app.get('/api/v1/admin/reports', async (req) => {
    await requireRole(req, 'moderator');
    const q = req.query as { status?: string };
    const status = q.status === 'RESOLVED' || q.status === 'DISMISSED' ? q.status : q.status === 'ALL' ? 'ALL' : 'OPEN';
    const { getMongoDb } = await import('../database/mongodb/client.js');
    const { ReportRepository } = await import('../database/mongodb/repositories/social.repository.js');
    const db = await getMongoDb();
    return { reports: await new ReportRepository(db).list(status, 100) };
  });

  /** @openapi POST /api/v1/admin/reports/:id/resolve — close a report. */
  app.post('/api/v1/admin/reports/:id/resolve', async (req) => {
    const me = await requireRole(req, 'moderator');
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as { status?: string; resolution?: string };
    if (body.status !== 'RESOLVED' && body.status !== 'DISMISSED') throw new ValidationError('Invalid resolution');
    const { getMongoDb } = await import('../database/mongodb/client.js');
    const { ReportRepository } = await import('../database/mongodb/repositories/social.repository.js');
    const db = await getMongoDb();
    const ok = await new ReportRepository(db).resolve(id, body.status, typeof body.resolution === 'string' ? body.resolution : '');
    if (!ok) throw new ValidationError('Report not found or already closed');
    await audit(me.id, 'admin.reports.resolve', id, { status: body.status });
    return { ok: true };
  });

  /** @openapi GET /api/v1/admin/tournaments — all tournaments, newest first. */
  app.get('/api/v1/admin/tournaments', async (req) => {
    await requireRole(req, 'moderator');
    const { getMongoDb } = await import('../database/mongodb/client.js');
    const { TournamentRepository } = await import('../database/mongodb/repositories/extended.repositories.js');
    const db = await getMongoDb();
    return { tournaments: await new TournamentRepository(db).listRecent(50) };
  });

  /** @openapi POST /api/v1/admin/tournaments/:id/cancel — stop a tournament. */
  app.post('/api/v1/admin/tournaments/:id/cancel', async (req) => {
    const me = await requireRole(req, 'admin');
    const { id } = req.params as { id: string };
    const { getMongoDb } = await import('../database/mongodb/client.js');
    const { TournamentRepository } = await import('../database/mongodb/repositories/extended.repositories.js');
    const db = await getMongoDb();
    const repo = new TournamentRepository(db);
    const t = await repo.findById(id);
    if (t === null) throw new ValidationError('Tournament not found');
    if (t.status === 'FINISHED') throw new ValidationError('Already finished');
    await repo.setStatus(id, 'CANCELLED');
    await audit(me.id, 'admin.tournaments.cancel', id);
    return { ok: true };
  });

  /** @openapi GET /api/v1/admin/clubs — all clubs with member counts. */
  app.get('/api/v1/admin/clubs', async (req) => {
    await requireRole(req, 'moderator');
    const { getMongoDb } = await import('../database/mongodb/client.js');
    const { ClubRepository } = await import('../database/mongodb/repositories/club.repository.js');
    const db = await getMongoDb();
    const clubs = await new ClubRepository(db).list(100);
    return { clubs: clubs.map(({ club, members }) => ({ ...club, members })) };
  });

  /** @openapi DELETE /api/v1/admin/clubs/:id — remove a club entirely. */
  app.delete('/api/v1/admin/clubs/:id', async (req, reply) => {
    const me = await requireRole(req, 'admin');
    const { id } = req.params as { id: string };
    const { getMongoDb } = await import('../database/mongodb/client.js');
    const { ClubRepository } = await import('../database/mongodb/repositories/club.repository.js');
    const { tryToObjectId } = await import('../database/mongodb/ids.js');
    const db = await getMongoDb();
    const repo = new ClubRepository(db);
    const club = await repo.findById(id);
    if (club === null) throw new ValidationError('Club not found');
    const oid = tryToObjectId(id);
    if (oid !== null) {
      await db.collection('clubs').deleteOne({ _id: oid });
      await db.collection('club_members').deleteMany({ clubId: id });
      await db.collection('chat_messages').deleteMany({ channelId: `club:${id}` });
    }
    await audit(me.id, 'admin.clubs.delete', id, { name: club.name });
    void reply.code(200);
    return { ok: true };
  });

  /** @openapi GET /api/v1/admin/audit — append-only audit trail (filterable). */
  app.get('/api/v1/admin/audit', async (req) => {
    await requireRole(req, 'moderator');
    const q = req.query as { action?: string; actor?: string; limit?: string };
    const { getMongoDb } = await import('../database/mongodb/client.js');
    const { AuditRepository } = await import('../database/mongodb/repositories/social.repository.js');
    const db = await getMongoDb();
    const limit = Math.min(Math.max(Number(q.limit ?? 50) || 50, 1), 200);
    return {
      entries: await new AuditRepository(db).list(limit, {
        ...(typeof q.action === 'string' ? { actionPrefix: q.action } : {}),
        ...(typeof q.actor === 'string' ? { actorId: q.actor } : {}),
      }),
    };
  });

  /** @openapi POST /api/v1/admin/announcements — publish a broadcast. */
  app.post('/api/v1/admin/announcements', async (req) => {
    const me = await requireRole(req, 'admin');
    const body = (req.body ?? {}) as { title?: string; body?: string; audience?: string; days?: number };
    const { getMongoDb } = await import('../database/mongodb/client.js');
    const { AnnouncementRepository } = await import('../database/mongodb/repositories/ops.repository.js');
    const db = await getMongoDb();
    try {
      const doc = await new AnnouncementRepository(db).create({
        title: typeof body.title === 'string' ? body.title : '',
        body: typeof body.body === 'string' ? body.body : '',
        audience: typeof body.audience === 'string' ? body.audience : 'all',
        endsAt: typeof body.days === 'number' && body.days > 0 ? new Date(Date.now() + body.days * 86400000) : null,
      });
      await audit(me.id, 'admin.announcements.create', doc._id, { title: doc.title });
      return { announcement: doc };
    } catch (err) {
      throw new ValidationError(err instanceof Error ? err.message : 'Publish failed');
    }
  });

  /** @openapi GET /api/v1/admin/announcements — all broadcasts. */
  app.get('/api/v1/admin/announcements', async (req) => {
    await requireRole(req, 'moderator');
    const { getMongoDb } = await import('../database/mongodb/client.js');
    const { AnnouncementRepository } = await import('../database/mongodb/repositories/ops.repository.js');
    const db = await getMongoDb();
    return { announcements: await new AnnouncementRepository(db).list() };
  });

  /** @openapi DELETE /api/v1/admin/announcements/:id — retract a broadcast. */
  app.delete('/api/v1/admin/announcements/:id', async (req, reply) => {
    const me = await requireRole(req, 'admin');
    const { id } = req.params as { id: string };
    const { getMongoDb } = await import('../database/mongodb/client.js');
    const { AnnouncementRepository } = await import('../database/mongodb/repositories/ops.repository.js');
    const db = await getMongoDb();
    const ok = await new AnnouncementRepository(db).remove(id);
    if (!ok) throw new ValidationError('Announcement not found');
    await audit(me.id, 'admin.announcements.delete', id);
    void reply.code(200);
    return { ok: true };
  });

  /** @openapi POST /api/v1/admin/users/:id/warn — official warning (notified). */
  app.post('/api/v1/admin/users/:id/warn', async (req) => {
    const me = await requireRole(req, 'moderator');
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as { message?: string };
    if (typeof body.message !== 'string' || body.message.trim().length < 3) throw new ValidationError('Warning text required');
    const { getMongoDb } = await import('../database/mongodb/client.js');
    const { NotificationRepository } = await import('../database/mongodb/repositories/extended.repositories.js');
    const db = await getMongoDb();
    await new NotificationRepository(db).create({
      userId: id, kind: 'warning', title: 'Moderator warning', body: body.message.trim().slice(0, 500),
    });
    await audit(me.id, 'admin.users.warn', id, { message: body.message.trim().slice(0, 200) });
    return { ok: true };
  });

  /** @openapi POST /api/v1/admin/users/:id/mute — silence chat for N minutes. */
  app.post('/api/v1/admin/users/:id/mute', async (req) => {
    const me = await requireRole(req, 'moderator');
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as { minutes?: number; reason?: string };
    const { getMongoDb } = await import('../database/mongodb/client.js');
    const { BanRepository } = await import('../database/mongodb/repositories/ops.repository.js');
    const db = await getMongoDb();
    const ban = await new BanRepository(db).mute(
      id,
      typeof body.reason === 'string' ? body.reason : 'chat violation',
      typeof body.minutes === 'number' ? body.minutes : 60,
      me.id,
    );
    await audit(me.id, 'admin.users.mute', id, { until: ban.until });
    return { ok: true, until: ban.until };
  });

  /** @openapi GET /api/v1/admin/bans — active moderation actions. */
  app.get('/api/v1/admin/bans', async (req) => {
    await requireRole(req, 'moderator');
    const { getMongoDb } = await import('../database/mongodb/client.js');
    const { BanRepository } = await import('../database/mongodb/repositories/ops.repository.js');
    const db = await getMongoDb();
    return { bans: await new BanRepository(db).listActive() };
  });

  /** @openapi DELETE /api/v1/admin/chat/:id — remove a chat message. */
  app.delete('/api/v1/admin/chat/:id', async (req, reply) => {
    const me = await requireRole(req, 'moderator');
    const { id } = req.params as { id: string };
    const { getMongoDb } = await import('../database/mongodb/client.js');
    const { tryToObjectId } = await import('../database/mongodb/ids.js');
    const db = await getMongoDb();
    const oid = tryToObjectId(id);
    const res = oid === null
      ? { deletedCount: 0 }
      : await db.collection('chat_messages').deleteOne({ _id: oid });
    if (res.deletedCount !== 1) throw new ValidationError('Message not found');
    await audit(me.id, 'admin.chat.delete', id);
    void reply.code(200);
    return { ok: true };
  });

  /** @openapi POST /api/v1/admin/games/:id/annul — void a recorded result. */
  app.post('/api/v1/admin/games/:id/annul', async (req) => {
    const me = await requireRole(req, 'admin');
    const { id } = req.params as { id: string };
    const { getMongoDb } = await import('../database/mongodb/client.js');
    const { GameRepository } = await import('../database/mongodb/repositories/game.repository.js');
    const db = await getMongoDb();
    const repo = new GameRepository(db);
    const doc = await repo.findByEngineId(id);
    if (doc === null) throw new ValidationError('Game not found');
    await db.collection('games').updateOne({ engineId: id }, { $set: { annulled: true } });
    await db.collection('replays').updateOne({ gameId: id }, { $set: { visibility: 'private' } });
    await audit(me.id, 'admin.games.annul', id, {
      note: 'result voided; replay hidden. Ratings are NOT auto-reversed — correct case-by-case.',
    });
    return { ok: true };
  });

  /** @openapi GET /api/v1/admin/ai/quotas — per-user daily overrides. */
  app.get('/api/v1/admin/ai/quotas', async (req) => {
    await requireRole(req, 'moderator');
    const q = req.query as { userId?: string };
    if (typeof q.userId !== 'string') throw new ValidationError('userId required');
    const day = new Date().toISOString().slice(0, 10);
    const { getMongoDb } = await import('../database/mongodb/client.js');
    const { QuotaRepository } = await import('../database/mongodb/repositories/ops.repository.js');
    const db = await getMongoDb();
    return { userId: q.userId, day, limit: await new QuotaRepository(db).get(q.userId, day) };
  });

  /** @openapi POST /api/v1/admin/ai/quotas — set a per-user daily override. */
  app.post('/api/v1/admin/ai/quotas', async (req) => {
    const me = await requireRole(req, 'admin');
    const body = (req.body ?? {}) as { userId?: string; limit?: number };
    if (typeof body.userId !== 'string' || typeof body.limit !== 'number') throw new ValidationError('Invalid quota');
    const day = new Date().toISOString().slice(0, 10);
    const { getMongoDb } = await import('../database/mongodb/client.js');
    const { QuotaRepository } = await import('../database/mongodb/repositories/ops.repository.js');
    const db = await getMongoDb();
    await new QuotaRepository(db).set(body.userId, day, body.limit);
    await audit(me.id, 'admin.ai.quota', body.userId, { limit: body.limit, day });
    return { ok: true };
  });
}
