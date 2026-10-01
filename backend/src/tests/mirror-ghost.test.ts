/**
 * Mirror fitting + ghost endpoints: pure style mapping, default profile
 * shape, empty ghost list, and ghost ownership gating.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { buildApp } from '../app.js';
import { ensureIndexes } from '../database/mongodb/indexes.js';
import { getMongoDb, closeMongo, __resetMongoForTests } from '../database/mongodb/client.js';
import { closeRedis, __resetRedisForTests } from '../database/redis/client.js';
import { __resetAuthServiceForTests } from '../modules/auth/service.js';
import { fitMirrorBot, MIRROR_DEFAULT } from '../modules/mirror/service.js';
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
  mongod = await MongoMemoryServer.create({ instance: { dbName: 'nexus_mirror' } });
  process.env['MONGODB_URI'] = mongod.getUri();
  process.env['MONGODB_DB_NAME'] = 'nexus_mirror';
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

describe('mirror fitting', () => {
  it('defaults thin history to the labeled baseline', () => {
    assert.deepEqual(fitMirrorBot({ games: 0, moves: 0, wallRate: 0, avgGain: 0, efficiency: 0 }), MIRROR_DEFAULT);
    assert.deepEqual(fitMirrorBot({ games: 2, moves: 5, wallRate: 0.4, avgGain: 2, efficiency: 0.8 }), MIRROR_DEFAULT);
  });

  it('maps wall-heavy sharp play to an aggressive personality', () => {
    const p = fitMirrorBot({ games: 6, moves: 120, wallRate: 0.45, avgGain: 3.2, efficiency: 0.75 });
    assert.ok(p.wallBias > 1.2);
    assert.ok(p.weights.wallAdvantage > 1);
    assert.ok(p.noise < 2);
    assert.equal(p.replySearch, true);
    assert.match(p.explanation, /45%/);
  });

  it('maps passive running to a quiet personality', () => {
    const p = fitMirrorBot({ games: 6, moves: 120, wallRate: 0.05, avgGain: 0.4, efficiency: 0.4 });
    assert.ok(p.wallBias < 0.8);
    assert.equal(p.replySearch, false);
    assert.ok(p.noise > 3);
  });
});

describe('mirror + ghost endpoints', () => {
  it('returns default profile and empty ghosts for fresh accounts; ghosts stay private', async () => {
    const a = await register('mirror_ana');
    const b = await register('mirror_ben');
    const m = await call('GET', '/api/v1/mirror', a.jar.cookie);
    assert.equal(m.status, 200);
    assert.equal((m.json as Record<string, unknown>)['games'], 0);
    const gl = await call('GET', '/api/v1/ghost/games', a.jar.cookie);
    assert.equal(gl.status, 200);
    assert.deepEqual(gl.json['games'], []);
    // Strangers cannot pull ghosts, even guessing ids.
    assert.ok((await call('GET', '/api/v1/ghost/games/g_abcdef', b.jar.cookie)).status >= 400);
    assert.ok((await call('GET', '/api/v1/ghost/games/g_abcdef', a.jar.cookie)).status >= 400);
  });
});
