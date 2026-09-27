/**
 * Ops depth: privacy settings, warn/mute, announcements, AI quota
 * overrides — in-process Mongo, app.inject for HTTP paths.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { buildApp } from '../app.js';
import { ensureIndexes } from '../database/mongodb/indexes.js';
import { getMongoDb, closeMongo, __resetMongoForTests } from '../database/mongodb/client.js';
import { UserRepository } from '../database/mongodb/repositories/user.repository.js';
import { SettingsRepository } from '../database/mongodb/repositories/settings.repository.js';
import { __resetAuthServiceForTests } from '../modules/auth/service.js';
import type { FastifyInstance } from 'fastify';

let mongod: MongoMemoryServer | null = null;
let app: FastifyInstance | null = null;

function cookieOf(res: { headers: Record<string, unknown> }): string {
  const set = res.headers['set-cookie'];
  const lines = Array.isArray(set) ? (set as string[]) : typeof set === 'string' ? [set] : [];
  return lines.map((l) => l.split(';')[0]).find((p) => p?.startsWith('nexus_session=')) ?? '';
}

async function register(email: string, username: string): Promise<string> {
  assert.ok(app !== null);
  const res = await app.inject({
    method: 'POST', url: '/api/v1/auth/register',
    payload: JSON.stringify({ email, username, password: 's3cret-pass' }),
    headers: { 'content-type': 'application/json' },
  });
  assert.equal(res.statusCode, 200);
  return cookieOf(res as unknown as { headers: Record<string, unknown> });
}

async function call(method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, cookie: string, body?: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  assert.ok(app !== null);
  const res = await app.inject({
    method, url,
    payload: body === undefined ? undefined : JSON.stringify(body),
    headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(cookie !== '' ? { cookie } : {}) },
  });
  return { status: res.statusCode, json: res.json() as Record<string, unknown> };
}

before(async () => {
  mongod = await MongoMemoryServer.create({ instance: { dbName: 'nexus_ops' } });
  process.env['MONGODB_URI'] = mongod.getUri();
  process.env['MONGODB_DB_NAME'] = 'nexus_ops';
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

describe('ops: privacy + moderation + announcements + quotas', () => {
  it('hides ratings when the owner opts out', async () => {
    const shy = await register('shy@e.com', 'shyplayer');
    const viewer = await register('curious@e.com', 'curious');
    const db = await getMongoDb();
    await new SettingsRepository(db).save(
      ((await new UserRepository(db).findByUsername('shyplayer'))?._id ?? ''),
      { showRating: false },
    );
    const pub = await call('GET', '/api/v1/profiles/shyplayer', viewer);
    assert.equal(pub.status, 200);
    assert.deepEqual(pub.json['ratings'], []);
    const self = await call('GET', '/api/v1/profiles/shyplayer', shy);
    assert.ok(((self.json['ratings'] as unknown[]) ?? []).length === 4);
  });

  it('warns, mutes and lists bans', async () => {
    const ownerCookie = await register('boss2@e.com', 'boss2');
    const targetCookie = await register('loud@e.com', 'loudmouth');
    const db = await getMongoDb();
    const users = new UserRepository(db);
    const boss = await users.findByUsername('boss2');
    assert.ok(boss !== null);
    assert.equal(await users.updateRole(boss._id, 'OWNER'), true);
    const target = await users.findByUsername('loudmouth');
    assert.ok(target !== null);

    assert.equal((await call('POST', `/api/v1/admin/users/${target._id}/warn`, ownerCookie, { message: 'easy on the chat' })).status, 200);
    const mute = await call('POST', `/api/v1/admin/users/${target._id}/mute`, ownerCookie, { minutes: 30, reason: 'spam' });
    assert.equal(mute.status, 200);
    const bans = await call('GET', '/api/v1/admin/bans', ownerCookie);
    assert.equal(bans.status, 200);
    assert.ok(((bans.json['bans'] as { userId: string }[]).some((b) => b.userId === target._id)));
    void targetCookie;
  });

  it('publishes and retracts announcements', async () => {
    const ownerCookie = await register('boss3@e.com', 'boss3');
    const db = await getMongoDb();
    const boss = await new UserRepository(db).findByUsername('boss3');
    assert.ok(boss !== null);
    await new UserRepository(db).updateRole(boss._id, 'ADMIN');

    const created = await call('POST', '/api/v1/admin/announcements', ownerCookie, {
      title: 'Weekend cup', body: 'Blitz arena Saturday.', audience: 'all', days: 7,
    });
    assert.equal(created.status, 200);
    const pub = await call('GET', '/api/v1/announcements', '');
    assert.equal(pub.status, 200);
    assert.ok(((pub.json['announcements'] as { title: string }[]).some((a) => a.title === 'Weekend cup')));
    const id = (created.json['announcement'] as { _id: string })._id;
    assert.ok(app !== null);
    const del = await app.inject({ method: 'DELETE', url: `/api/v1/admin/announcements/${id}`, headers: { cookie: ownerCookie } });
    assert.equal(del.statusCode, 200);
  });

  it('honors a zero AI quota override without touching the network', async () => {
    const ownerCookie = await register('boss4@e.com', 'boss4');
    const db = await getMongoDb();
    const users = new UserRepository(db);
    const boss = await users.findByUsername('boss4');
    assert.ok(boss !== null);
    await users.updateRole(boss._id, 'ADMIN');

    const realKey = process.env['GROQ_API_KEY'];
    process.env['GROQ_API_KEY'] = 'test-key-quota';
    const realFetch = globalThis.fetch;
    let called = false;
    globalThis.fetch = ((async () => {
      called = true;
      return new Response('{}', { status: 200 });
    }) as unknown) as typeof fetch;
    try {
      assert.equal((await call('POST', '/api/v1/admin/ai/quotas', ownerCookie, { userId: boss._id, limit: 0 })).status, 200);
      const { coachExplanation } = await import('../modules/ai/complete.js');
      const res = await coachExplanation(boss._id, 'groq', {
        moveNumber: 1, playedAction: 'move 1,4', bestAction: 'move 1,4',
        ownPathBefore: 8, ownPathAfter: 7, oppPathBefore: 8, oppPathAfter: 8,
      });
      assert.equal(res.ok, false);
      assert.ok((res.error ?? '').includes('quota'));
      assert.equal(called, false);
    } finally {
      globalThis.fetch = realFetch;
      if (realKey === undefined) delete process.env['GROQ_API_KEY'];
      else process.env['GROQ_API_KEY'] = realKey;
    }
  });
});
