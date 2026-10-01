/**
 * Cosmetics (COS-001): catalog shape, free equip, premium gating, profile
 * frame plumbing. No gameplay effect anywhere by construction.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { buildApp } from '../app.js';
import { ensureIndexes } from '../database/mongodb/indexes.js';
import { getMongoDb, closeMongo, __resetMongoForTests } from '../database/mongodb/client.js';
import { closeRedis, __resetRedisForTests } from '../database/redis/client.js';
import { __resetAuthServiceForTests } from '../modules/auth/service.js';
import type { FastifyInstance } from 'fastify';

let mongod: MongoMemoryServer | null = null;
let app: FastifyInstance | null = null;

interface Jar {
  cookie: string;
}

async function call(method: 'GET' | 'POST', url: string, cookie: string, body?: unknown): Promise<{ status: number; json: Record<string, unknown>; jar: Jar }> {
  assert.ok(app !== null);
  const jar: Jar = { cookie };
  const res = await app.inject({
    method,
    url,
    payload: body === undefined ? undefined : JSON.stringify(body),
    headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(cookie !== '' ? { cookie } : {}) },
  });
  const set = res.headers['set-cookie'];
  const lines = Array.isArray(set) ? (set as string[]) : typeof set === 'string' ? [set] : [];
  for (const line of lines) {
    const pair = line.split(';')[0];
    if (pair !== undefined && pair.startsWith('nexus_session=')) jar.cookie = pair;
  }
  return { status: res.statusCode, json: res.json() as Record<string, unknown>, jar };
}

async function register(username: string): Promise<{ jar: Jar; id: string }> {
  const res = await call('POST', '/api/v1/auth/register', '', { email: `${username}@example.com`, username, password: 's3cret-pass' });
  assert.equal(res.status, 200);
  const me = await call('GET', '/api/v1/auth/me', res.jar.cookie);
  return { jar: res.jar, id: String((me.json['user'] as Record<string, unknown>)['id']) };
}

before(async () => {
  mongod = await MongoMemoryServer.create({ instance: { dbName: 'nexus_cosmetics' } });
  process.env['MONGODB_URI'] = mongod.getUri();
  process.env['MONGODB_DB_NAME'] = 'nexus_cosmetics';
  __resetMongoForTests();
  __resetRedisForTests();
  __resetAuthServiceForTests();
  await ensureIndexes(await getMongoDb());
  app = await buildApp();
});

after(async () => {
  if (app !== null) await app.close().catch(() => undefined);
  await closeRedis().catch(() => undefined);
  await closeMongo().catch(() => undefined);
  __resetMongoForTests();
  __resetRedisForTests();
  if (mongod !== null) await mongod.stop().catch(() => undefined);
  mongod = null;
});

describe('cosmetics catalog + frames', () => {
  it('lists 6 frames, equips free ones, gates premium ones, shows on profile', async () => {
    const a = await register('cos_alice');
    const cat = await call('GET', '/api/v1/cosmetics', a.jar.cookie);
    assert.equal(cat.status, 200);
    const frames = cat.json['frames'] as { id: string; premium: boolean; owned: boolean }[];
    assert.equal(frames.length, 6);
    assert.ok(frames.filter((f) => !f.premium).every((f) => f.owned));
    assert.ok(frames.filter((f) => f.premium).every((f) => !f.owned));
    assert.equal(cat.json['equipped'], 'frame-none');

    // Unknown id rejected.
    assert.ok((await call('POST', '/api/v1/cosmetics/frame-nope/equip', a.jar.cookie)).status >= 400);
    // Premium locked without entitlement.
    assert.ok((await call('POST', '/api/v1/cosmetics/frame-gold/equip', a.jar.cookie)).status >= 400);
    // Free frame equips and appears on the profile.
    assert.equal((await call('POST', '/api/v1/cosmetics/frame-bronze/equip', a.jar.cookie)).status, 200);
    const prof = await call('GET', '/api/v1/profiles/cos_alice', a.jar.cookie);
    assert.equal(prof.status, 200);
    assert.equal(prof.json['frame'], 'frame-bronze');

    // Admin-granted entitlement unlocks premium frames.
    const db = await getMongoDb();
    const { EntitlementRepository } = await import('../database/mongodb/repositories/premium.repository.js');
    await new EntitlementRepository(db).grant(a.id, 'PREMIUM_COSMETICS', 'test');
    assert.equal((await call('POST', '/api/v1/cosmetics/frame-gold/equip', a.jar.cookie)).status, 200);
    const cat2 = await call('GET', '/api/v1/cosmetics', a.jar.cookie);
    assert.ok(((cat2.json['frames'] as { id: string; owned: boolean }[]).find((f) => f.id === 'frame-gold')?.owned ?? false));
  });
});
