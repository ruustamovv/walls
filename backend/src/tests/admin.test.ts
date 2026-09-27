/**
 * Admin command center over HTTP (app.inject, in-process Mongo):
 * RBAC gates, overview/stats, user moderation, reports lifecycle,
 * tournament cancel, club delete, flags, audit trail.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { buildApp } from '../app.js';
import { ensureIndexes } from '../database/mongodb/indexes.js';
import { getMongoDb, closeMongo, __resetMongoForTests } from '../database/mongodb/client.js';
import { UserRepository } from '../database/mongodb/repositories/user.repository.js';
import { __resetAuthServiceForTests } from '../modules/auth/service.js';
import type { FastifyInstance } from 'fastify';

let mongod: MongoMemoryServer | null = null;
let app: FastifyInstance | null = null;

function cookiesOf(res: { headers: Record<string, unknown> }): string {
  const set = res.headers['set-cookie'];
  const lines = Array.isArray(set) ? (set as string[]) : typeof set === 'string' ? [set] : [];
  const pair = lines.map((l) => l.split(';')[0]).find((p) => p?.startsWith('nexus_session='));
  return pair ?? '';
}

async function post(path: string, body: unknown, cookie = ''): Promise<{ status: number; json: Record<string, unknown> }> {
  assert.ok(app !== null);
  const res = await app.inject({
    method: 'POST', url: path,
    payload: JSON.stringify(body),
    headers: { 'content-type': 'application/json', ...(cookie !== '' ? { cookie } : {}) },
  });
  return { status: res.statusCode, json: res.json() as Record<string, unknown> };
}

async function get(path: string, cookie = ''): Promise<{ status: number; json: Record<string, unknown> }> {
  assert.ok(app !== null);
  const res = await app.inject({ method: 'GET', url: path, headers: cookie !== '' ? { cookie } : {} });
  return { status: res.statusCode, json: res.json() as Record<string, unknown> };
}

async function register(email: string, username: string): Promise<string> {
  assert.ok(app !== null);
  const res = await app.inject({
    method: 'POST', url: '/api/v1/auth/register',
    payload: JSON.stringify({ email, username, password: 's3cret-pass' }),
    headers: { 'content-type': 'application/json' },
  });
  assert.equal(res.statusCode, 200);
  return cookiesOf(res as unknown as { headers: Record<string, unknown> });
}

before(async () => {
  mongod = await MongoMemoryServer.create({ instance: { dbName: 'nexus_admin' } });
  process.env['MONGODB_URI'] = mongod.getUri();
  process.env['MONGODB_DB_NAME'] = 'nexus_admin';
  __resetMongoForTests();
  __resetAuthServiceForTests();
  await ensureIndexes(await getMongoDb());
  app = await buildApp();
});

after(async () => {
  if (app !== null) await app.close().catch(() => undefined);
  await closeMongo().catch(() => undefined);
  const { closeRedis, __resetRedisForTests } = await import('../database/redis/client.js');
  await closeRedis().catch(() => undefined);
  __resetMongoForTests();
  __resetRedisForTests();
  __resetAuthServiceForTests();
  if (mongod !== null) await mongod.stop().catch(() => undefined);
  mongod = null;
});

describe('admin command center', () => {
  it('gates everything behind roles and runs the full ops loop', async () => {
    const ownerCookie = await register('owner@e.com', 'theowner');
    const userCookie = await register('pleb@e.com', 'pleb');
    const db = await getMongoDb();
    const users = new UserRepository(db);
    const owner = await users.findByUsername('theowner');
    assert.ok(owner !== null);
    assert.equal(await users.updateRole(owner._id, 'OWNER'), true);

    // Non-admin is fenced out.
    assert.equal((await get('/api/v1/admin/overview', userCookie)).status, 403);
    assert.equal((await get('/api/v1/admin/users?search=the', userCookie)).status, 403);

    // Overview + stats serve real counts.
    const ov = await get('/api/v1/admin/overview', ownerCookie);
    assert.equal(ov.status, 200);
    assert.equal(ov.json['users'], 2);
    const stats = await get('/api/v1/admin/stats', ownerCookie);
    assert.equal(stats.status, 200);
    assert.ok(Array.isArray((stats.json as { usersPerDay: unknown[] }).usersPerDay));

    // User moderation: suspend then restore.
    const found = await get('/api/v1/admin/users?search=pleb', ownerCookie);
    const pleb = ((found.json['users'] as { id: string }[])[0] ?? null) as { id: string } | null;
    assert.ok(pleb !== null);
    assert.equal((await post(`/api/v1/admin/users/${pleb.id}/status`, { status: 'SUSPENDED' }, ownerCookie)).status, 200);
    assert.equal((await post(`/api/v1/admin/users/${pleb.id}/status`, { status: 'ACTIVE' }, ownerCookie)).status, 200);

    // Reports: user files, admin triages.
    assert.equal((await post('/api/v1/reports', { targetType: 'user', targetId: 'theowner', reason: 'testing the queue' }, userCookie)).status, 200);
    const open = await get('/api/v1/admin/reports', ownerCookie);
    assert.equal(open.status, 200);
    const report = ((open.json['reports'] as { _id: string }[])[0] ?? null) as { _id: string } | null;
    assert.ok(report !== null);
    assert.equal((await post(`/api/v1/admin/reports/${report._id}/resolve`, { status: 'RESOLVED', resolution: 'test case' }, ownerCookie)).status, 200);
    const cleared = await get('/api/v1/admin/reports', ownerCookie);
    assert.equal((cleared.json['reports'] as unknown[]).length, 0);

    // Tournaments: create, cancel.
    const created = await post('/api/v1/tournaments', { title: 'Doomed Cup', format: 'single-elim' }, ownerCookie);
    assert.equal(created.status, 200);
    const tourId = (created.json['tournament'] as { _id: string })._id;
    assert.equal((await post(`/api/v1/admin/tournaments/${tourId}/cancel`, {}, ownerCookie)).status, 200);
    const listed = await get('/api/v1/admin/tournaments', ownerCookie);
    const cancelled = ((listed.json['tournaments'] as { _id: string; status: string }[]).find((t) => t._id === tourId) ?? null);
    assert.equal(cancelled?.status, 'CANCELLED');

    // Clubs: create, admin-delete.
    const club = await post('/api/v1/clubs', { name: 'Temp Club', description: '' }, ownerCookie);
    assert.equal(club.status, 200);
    const clubId = (club.json['club'] as { _id: string })._id;
    assert.ok(app !== null);
    const del = await app.inject({ method: 'DELETE', url: `/api/v1/admin/clubs/${clubId}`, headers: { cookie: ownerCookie } });
    assert.equal(del.statusCode, 200);

    // Flags + audit trail.
    assert.equal((await app.inject({
      method: 'PUT', url: '/api/v1/admin/flags',
      payload: JSON.stringify({ key: 'tournament_beta', enabled: true }),
      headers: { 'content-type': 'application/json', cookie: ownerCookie },
    })).statusCode, 200);
    const flags = await get('/api/v1/admin/flags', ownerCookie);
    assert.ok(((flags.json['flags'] as { key: string }[]).some((f) => f.key === 'TOURNAMENT_BETA')));
    const auditRes = await get('/api/v1/admin/audit', ownerCookie);
    const actions = (auditRes.json['entries'] as { action: string }[]).map((e) => e.action);
    assert.ok(actions.includes('admin.tournaments.cancel'));
    assert.ok(actions.includes('admin.reports.resolve'));
  });
});
