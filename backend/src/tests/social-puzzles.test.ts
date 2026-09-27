/**
 * Puzzles (deterministic daily + grading + streaks), friends
 * (request/accept/list/block) and admin RBAC — against in-process Mongo.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { MongoMemoryServer } from 'mongodb-memory-server';
import type { FastifyRequest } from 'fastify';
import { getDailyPuzzle, attemptDaily, streakFrom } from '../modules/puzzles/service.js';
import { gradeAttempt } from '../../../engine/typescript/dist/puzzles/index.js';
import { AuthService } from '../modules/auth/service.js';
import { MongoUserStore } from '../modules/auth/store.js';
import { UserRepository } from '../database/mongodb/repositories/user.repository.js';
import { FriendRepository, AuditRepository, FlagRepository } from '../database/mongodb/repositories/social.repository.js';
import { ensureIndexes } from '../database/mongodb/indexes.js';
import { getMongoDb, closeMongo, __resetMongoForTests } from '../database/mongodb/client.js';
import { requireRole } from '../modules/admin/rbac.js';
import { getAuthService, __resetAuthServiceForTests } from '../modules/auth/service.js';

let mongod: MongoMemoryServer | null = null;

before(async () => {
  mongod = await MongoMemoryServer.create({ instance: { dbName: 'nexus_social' } });
  process.env['MONGODB_URI'] = mongod.getUri();
  process.env['MONGODB_DB_NAME'] = 'nexus_social';
  __resetMongoForTests();
  __resetAuthServiceForTests();
  await ensureIndexes(await getMongoDb());
});

after(async () => {
  await closeMongo().catch(() => undefined);
  const { closeRedis, __resetRedisForTests } = await import('../database/redis/client.js');
  await closeRedis().catch(() => undefined);
  __resetMongoForTests();
  __resetRedisForTests();
  __resetAuthServiceForTests();
  if (mongod !== null) await mongod.stop().catch(() => undefined);
  mongod = null;
});

function fakeReq(sessionId: string): FastifyRequest {
  return { cookies: { nexus_session: sessionId }, headers: {} } as unknown as FastifyRequest;
}

describe('puzzles: daily + streaks', () => {
  it('serves the same puzzle twice and grades the solution as solved', async () => {
    const a = await getDailyPuzzle('2026-09-27');
    const b = await getDailyPuzzle('2026-09-27');
    assert.deepEqual(a.solution, b.solution);
    const verdict = gradeAttempt(a, a.solution);
    assert.equal(verdict.solved, true);
  });

  it('records a solving attempt and reports a streak', async () => {
    const db = await getMongoDb();
    const auth = new AuthService(new MongoUserStore(new UserRepository(db)));
    const reg = await auth.register({ email: 'pz@example.com', username: 'puzzler', password: 's3cret-pass' });
    const puzzle = await getDailyPuzzle('2026-09-27');
    const res = await attemptDaily(reg.user.id, { ...puzzle.solution }, '2026-09-27');
    assert.equal(res.solved, true);
    // solvedDates keys on wall-clock creation day; only assert shape here.
    assert.equal(typeof res.solvedToday, 'boolean');
    assert.ok(res.streak >= 0);
  });

  it('computes consecutive-day streaks', () => {
    assert.equal(streakFrom(['2026-09-27', '2026-09-26', '2026-09-25'], '2026-09-27'), 3);
    assert.equal(streakFrom(['2026-09-26', '2026-09-25'], '2026-09-27'), 2); // yesterday-anchored
    assert.equal(streakFrom(['2026-09-24'], '2026-09-27'), 0); // gap breaks it
    assert.equal(streakFrom([], '2026-09-27'), 0);
  });
});

describe('friends: request -> accept -> list -> block', () => {
  it('full friendship lifecycle', async () => {
    const db = await getMongoDb();
    const auth = new AuthService(new MongoUserStore(new UserRepository(db)));
    const a = await auth.register({ email: 'fa@example.com', username: 'frienda', password: 's3cret-pass' });
    const b = await auth.register({ email: 'fb@example.com', username: 'friendb', password: 's3cret-pass' });
    const friends = new FriendRepository(db);

    const reqDoc = await friends.request(a.user.id, b.user.id);
    assert.equal(reqDoc.status, 'PENDING');
    // Duplicate request returns the pending one (anti-duplicate).
    const dup = await friends.request(a.user.id, b.user.id);
    assert.equal(dup._id, reqDoc._id);

    const incoming = await friends.incoming(b.user.id);
    assert.equal(incoming.length, 1);
    assert.equal(await friends.accept(reqDoc._id, b.user.id), true);
    assert.equal(await friends.areFriends(a.user.id, b.user.id), true);
    assert.equal((await friends.list(a.user.id)).length, 1);

    await friends.block(a.user.id, b.user.id);
    assert.equal(await friends.areFriends(a.user.id, b.user.id), false);
    assert.equal((await friends.list(a.user.id)).length, 0);
  });
});

describe('clubs: found -> join -> roster -> leave', () => {
  it('full club lifecycle', async () => {
    const db = await getMongoDb();
    const { ClubRepository } = await import('../database/mongodb/repositories/club.repository.js');
    const auth = new AuthService(new MongoUserStore(new UserRepository(db)));
    const owner = await auth.register({ email: 'co@example.com', username: 'clubowner', password: 's3cret-pass' });
    const joiner = await auth.register({ email: 'cj@example.com', username: 'clubjoiner', password: 's3cret-pass' });
    const clubs = new ClubRepository(db);

    const club = await clubs.create(owner.user.id, 'Wall enjoyers', 'We love walls');
    assert.equal(club.name, 'Wall enjoyers');
    assert.equal(await clubs.join(club._id, joiner.user.id), true);
    // Join is idempotent.
    assert.equal(await clubs.join(club._id, joiner.user.id), true);
    assert.equal((await clubs.members(club._id)).length, 2);
    // Owner cannot abandon the club by leaving.
    assert.equal(await clubs.leave(club._id, owner.user.id), false);
    assert.equal(await clubs.leave(club._id, joiner.user.id), true);
    assert.equal((await clubs.members(club._id)).length, 1);
    assert.equal((await clubs.myClubs(joiner.user.id)).length, 0);
  });
});

describe('auth: password reset round-trip', () => {
  it('consumes a single-use token and rotates the password', async () => {
    const db = await getMongoDb();
    const auth = new AuthService(new MongoUserStore(new UserRepository(db)));
    const reg = await auth.register({ email: 'pr@example.com', username: 'resetme', password: 's3cret-pass' });
    const { createHash } = await import('node:crypto');
    const token = 'test-token-abcdef-1234567890abcdef';
    await db.collection('password_resets').insertOne({
      tokenHash: createHash('sha256').update(token).digest('hex'),
      userId: reg.user.id,
      expiresAt: new Date(Date.now() + 3600000),
      createdAt: new Date(),
    });
    const { confirmReset } = await import('../modules/auth/passwordReset.js');
    assert.equal(await confirmReset(token, 'brand-new-pass', () => Promise.resolve(0)), true);
    // Single-use: second consume fails.
    assert.equal(await confirmReset(token, 'another-pass', () => Promise.resolve(0)), false);
    // New password works, old does not.
    await auth.login({ login: 'resetme', password: 'brand-new-pass' });
    await assert.rejects(() => auth.login({ login: 'resetme', password: 's3cret-pass' }));
  });
});

describe('premium: grant -> list -> revoke', () => {
  it('entitlement lifecycle', async () => {
    const db = await getMongoDb();
    const { EntitlementRepository } = await import('../database/mongodb/repositories/premium.repository.js');
    const auth = new AuthService(new MongoUserStore(new UserRepository(db)));
    const reg = await auth.register({ email: 'pm@example.com', username: 'paying', password: 's3cret-pass' });
    const repo = new EntitlementRepository(db);
    assert.equal(await repo.has(reg.user.id, 'AI_COACH_UNLIMITED'), false);
    await repo.grant(reg.user.id, 'AI_COACH_UNLIMITED', 'test');
    assert.equal(await repo.has(reg.user.id, 'AI_COACH_UNLIMITED'), true);
    assert.deepEqual(await repo.list(reg.user.id), ['AI_COACH_UNLIMITED']);
    // Idempotent re-grant.
    await repo.grant(reg.user.id, 'AI_COACH_UNLIMITED', 'test');
    assert.deepEqual(await repo.list(reg.user.id), ['AI_COACH_UNLIMITED']);
    await repo.revoke(reg.user.id, 'AI_COACH_UNLIMITED');
    assert.equal(await repo.has(reg.user.id, 'AI_COACH_UNLIMITED'), false);
  });
});

describe('admin: rbac + audit + flags', () => {
  it('rejects non-admins and serves freshly promoted admins', async () => {
    const db = await getMongoDb();
    // Routes resolve the shared singleton — test through it so sessions match.
    const auth = await getAuthService();
    const plain = await auth.register({ email: 'pl@example.com', username: 'plain', password: 's3cret-pass' });
    await assert.rejects(() => requireRole(fakeReq(plain.session.id), 'moderator'));

    const boss = await auth.register({ email: 'ad@example.com', username: 'boss', password: 's3cret-pass' });
    assert.equal(await new UserRepository(db).updateRole(boss.user.id, 'ADMIN'), true);
    // Role refreshes from Mongo without re-login.
    const me = await requireRole(fakeReq(boss.session.id), 'moderator');
    assert.equal(me.username, 'boss');
    assert.equal(me.role, 'admin');
    await assert.rejects(() => requireRole(fakeReq(plain.session.id), 'admin'));
  });

  it('appends and lists audit entries; sets and lists flags', async () => {
    const db = await getMongoDb();
    const audit = new AuditRepository(db);
    await audit.append('actor1', 'admin.flags.set', 'AI_COACH', { enabled: true });
    const entries = await audit.list(10);
    assert.ok(entries.some((e) => e.action === 'admin.flags.set'));

    const flags = new FlagRepository(db);
    const flag = await flags.set('ai_coach', true);
    assert.equal(flag.key, 'AI_COACH');
    assert.equal(flag.enabled, true);
    assert.ok((await flags.list()).some((f) => f.key === 'AI_COACH'));
  });
});
