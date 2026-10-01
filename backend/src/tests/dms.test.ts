/**
 * Friend DMs (CHT-004): friendship-gated threads, scope/moderation gates,
 * guest fencing. HTTP + in-process Mongo.
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

function storeCookies(jar: Jar, headers: Record<string, unknown>): void {
  const set = headers['set-cookie'];
  const lines = Array.isArray(set) ? (set as string[]) : typeof set === 'string' ? [set] : [];
  for (const line of lines) {
    const pair = line.split(';')[0];
    if (pair !== undefined && pair.startsWith('nexus_session=')) jar.cookie = pair;
  }
}

async function call(method: 'GET' | 'POST' | 'PUT', url: string, cookie: string, body?: unknown): Promise<{ status: number; json: Record<string, unknown>; jar: Jar }> {
  assert.ok(app !== null);
  const jar: Jar = { cookie };
  const res = await app.inject({
    method,
    url,
    payload: body === undefined ? undefined : JSON.stringify(body),
    headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(cookie !== '' ? { cookie } : {}) },
  });
  storeCookies(jar, res.headers as Record<string, unknown>);
  return { status: res.statusCode, json: res.json() as Record<string, unknown>, jar };
}

async function register(username: string): Promise<{ jar: Jar; id: string }> {
  const res = await call('POST', '/api/v1/auth/register', '', { email: `${username}@example.com`, username, password: 's3cret-pass' });
  assert.equal(res.status, 200);
  const me = await call('GET', '/api/v1/auth/me', res.jar.cookie);
  return { jar: res.jar, id: String((me.json['user'] as Record<string, unknown>)['id']) };
}

async function befriend(a: { jar: Jar }, bName: string, b: { jar: Jar }): Promise<void> {
  await call('POST', '/api/v1/friends/request', a.jar.cookie, { username: bName });
  const incoming = await call('GET', '/api/v1/friends/requests', b.jar.cookie);
  const reqId = String((((incoming.json['requests'] as { id: string }[])[0] as { id: string })?.id ?? ''));
  assert.ok(reqId !== '');
  assert.equal((await call('POST', '/api/v1/friends/accept', b.jar.cookie, { requestId: reqId })).status, 200);
}

before(async () => {
  mongod = await MongoMemoryServer.create({ instance: { dbName: 'nexus_dms' } });
  process.env['MONGODB_URI'] = mongod.getUri();
  process.env['MONGODB_DB_NAME'] = 'nexus_dms';
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

describe('friend DMs', () => {
  it('friends exchange messages; strangers, scopes, guests and filters gate', async () => {
    const a = await register('dm_alice');
    const b = await register('dm_bob');
    const c = await register('dm_carol');
    await befriend(a, 'dm_bob', b);

    // Stranger cannot read or write.
    assert.ok((await call('GET', '/api/v1/dms/dm_alice', c.jar.cookie)).status >= 400);
    assert.ok((await call('POST', '/api/v1/dms/dm_alice', c.jar.cookie, { body: 'hey' })).status >= 400);

    // Happy path both directions.
    assert.equal((await call('POST', '/api/v1/dms/dm_bob', a.jar.cookie, { body: 'hey bob' })).status, 200);
    assert.equal((await call('POST', '/api/v1/dms/dm_alice', b.jar.cookie, { body: 'hey alice' })).status, 200);
    const hist = await call('GET', '/api/v1/dms/dm_bob', a.jar.cookie);
    assert.equal(hist.status, 200);
    assert.equal((hist.json['messages'] as unknown[]).length, 2);
    const threads = await call('GET', '/api/v1/dms', a.jar.cookie);
    const row = ((threads.json['threads'] as { username: string; lastBody: string | null }[]) ?? []).find((t) => t.username === 'dm_bob');
    assert.ok(row !== undefined && row.lastBody !== null);

    // Recipient opted out of all chat.
    assert.equal((await call('PUT', '/api/v1/settings', b.jar.cookie, { chatScope: 'nobody' })).status, 200);
    assert.ok((await call('POST', '/api/v1/dms/dm_bob', a.jar.cookie, { body: 'are you there' })).status >= 400);
    assert.equal((await call('PUT', '/api/v1/settings', b.jar.cookie, { chatScope: 'everyone' })).status, 200);

    // Blocklisted content rejected (and auto-reported).
    const blocked = await call('POST', '/api/v1/dms/dm_bob', a.jar.cookie, { body: 'you are such a fucker' });
    assert.ok(blocked.status >= 400);
    const db = await getMongoDb();
    const { ReportRepository } = await import('../database/mongodb/repositories/social.repository.js');
    const open = await new ReportRepository(db).list('OPEN', 50);
    assert.ok(open.some((r) => r.targetId === a.id && r.reason.includes('[auto-flag')));

    // Guests fenced out.
    const gres = await call('POST', '/api/v1/auth/guest', '', {});
    assert.equal(gres.status, 200);
    assert.ok((await call('POST', '/api/v1/dms/dm_bob', gres.jar.cookie, { body: 'hi' })).status >= 400);
  });
});
