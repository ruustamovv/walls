/**
 * Visibility enforcement (RPL-002 + PRF-004): private replays 403 for
 * strangers but open for players; friends-only gates; unlisted works by
 * link; watch lists public only; search hides private profiles; history
 * visibility gates recent games.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { buildApp } from '../app.js';
import { attachGameSocket } from '../realtime/sockets/gameSocket.js';
import { ensureIndexes } from '../database/mongodb/indexes.js';
import { getMongoDb, closeMongo, __resetMongoForTests } from '../database/mongodb/client.js';
import { closeRedis, __resetRedisForTests } from '../database/redis/client.js';
import { __resetAuthServiceForTests } from '../modules/auth/service.js';
import type { FastifyInstance } from 'fastify';
import type { Server as SocketServer } from 'socket.io';
import type { AddressInfo } from 'node:net';

let mongod: MongoMemoryServer | null = null;
let app: FastifyInstance | null = null;
let sio: SocketServer | null = null;
let base = '';

interface Jar {
  cookie: string;
}

function storeCookies(jar: Jar, res: Response): void {
  const getSet = (res.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie;
  const lines = typeof getSet === 'function' ? getSet.call(res.headers) : [];
  for (const line of lines) {
    const pair = line.split(';')[0];
    if (pair !== undefined && pair.startsWith('nexus_session=')) jar.cookie = pair;
  }
}

async function api(jar: Jar | null, path: string, init: RequestInit = {}): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(jar !== null && jar.cookie !== '' ? { Cookie: jar.cookie } : {}), ...(init.headers ?? {}) },
  });
  if (jar !== null) storeCookies(jar, res);
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, body };
}

function post(jar: Jar | null, path: string, payload: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  return api(jar, path, { method: 'POST', body: JSON.stringify(payload) });
}

async function register(username: string): Promise<{ jar: Jar; id: string }> {
  const jar: Jar = { cookie: '' };
  const res = await post(jar, '/api/v1/auth/register', { email: `${username}@example.com`, username, password: 's3cret-pass' });
  assert.equal(res.status, 200);
  const me = await api(jar, '/api/v1/auth/me');
  return { jar, id: String((me.body['user'] as Record<string, unknown>)['id']) };
}

before(async () => {
  mongod = await MongoMemoryServer.create({ instance: { dbName: 'nexus_visibility' } });
  process.env['MONGODB_URI'] = mongod.getUri();
  process.env['MONGODB_DB_NAME'] = 'nexus_visibility';
  __resetMongoForTests();
  __resetRedisForTests();
  __resetAuthServiceForTests();
  await ensureIndexes(await getMongoDb());
  app = await buildApp();
  await app.listen({ port: 0, host: '127.0.0.1' });
  const addr = app.server.address() as AddressInfo;
  base = `http://127.0.0.1:${addr.port}`;
  sio = attachGameSocket(app.server);
});

after(async () => {
  if (sio !== null) await sio.close().catch(() => undefined);
  if (app !== null) await app.close().catch(() => undefined);
  await closeRedis().catch(() => undefined);
  await closeMongo().catch(() => undefined);
  __resetMongoForTests();
  __resetRedisForTests();
  if (mongod !== null) await mongod.stop().catch(() => undefined);
  mongod = null;
});

describe('visibility enforcement', () => {
  it('private games hide replays/watch/history from strangers, open for players', async () => {
    const a = await register('vis_alice');
    const b = await register('vis_bob');
    const c = await register('vis_carol');

    const g = await post(a.jar, '/api/v1/games', { timeControl: '3+0', opponentId: b.id, visibility: 'private' });
    assert.equal(g.status, 200);
    const gameId = String(g.body['id']);

    // Stranger: replay blocked, watch clean, profile shows no games.
    assert.ok((await api(c.jar, `/api/v1/replays/${gameId}`)).status >= 400);
    const watch = await api(c.jar, '/api/v1/games/live');
    assert.ok(!((watch.body['games'] as { id: string }[]).some((x) => x.id === gameId)));

    // Players: replay + review open.
    assert.equal((await api(a.jar, `/api/v1/replays/${gameId}`)).status, 200);
    assert.equal((await api(b.jar, `/api/v1/replays/${gameId}`)).status, 200);

    // Private profile: invisible in search, 404 to strangers.
    await api(a.jar, '/api/v1/settings', { method: 'PUT', body: JSON.stringify({ profileVisibility: 'private' }) });
    const search = await api(c.jar, '/api/v1/search?q=vis_alice');
    assert.ok(!((search.body['players'] as { username: string }[]).some((p) => p.username === 'vis_alice')));
    assert.ok((await api(c.jar, '/api/v1/profiles/vis_alice')).status >= 400);
    assert.equal((await api(a.jar, '/api/v1/profiles/vis_alice')).status, 200);

    // Friends-only history: stranger sees none, friend sees games.
    const g2 = await post(a.jar, '/api/v1/games', { timeControl: '3+0', opponentId: b.id });
    const gid2 = String(g2.body['id']);
    await post(b.jar, `/api/v1/games/${gid2}/resign`, {});
    await api(a.jar, '/api/v1/settings', {
      method: 'PUT',
      body: JSON.stringify({ profileVisibility: 'public', historyVisibility: 'friends' }),
    });
    const asStranger = await api(c.jar, '/api/v1/profiles/vis_alice');
    assert.equal(asStranger.status, 200);
    assert.deepEqual(asStranger.body['recentGames'], []);
    // Befriend, then history appears.
    await post(c.jar, '/api/v1/friends/request', { username: 'vis_alice' });
    const incoming = await api(a.jar, '/api/v1/friends/requests');
    const reqId = String(((incoming.body['requests'] as { id: string }[])[0] as { id: string })?.id ?? '');
    assert.ok(reqId !== '');
    assert.equal((await post(a.jar, '/api/v1/friends/accept', { requestId: reqId })).status, 200);
    const asFriend = await api(c.jar, '/api/v1/profiles/vis_alice');
    assert.ok(((asFriend.body['recentGames'] as unknown[])?.length ?? 0) >= 1);
  });

  it('unlisted replays open by link without auth', async () => {
    const a = await register('vis_dan');
    const b = await register('vis_erin');
    const g = await post(a.jar, '/api/v1/games', { timeControl: '3+0', opponentId: b.id, visibility: 'unlisted' });
    const gameId = String(g.body['id']);
    assert.equal((await api(null, `/api/v1/replays/${gameId}`)).status, 200);
  });
});
