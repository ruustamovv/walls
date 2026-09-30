/**
 * Guest lifecycle E2E (HTTP + sockets, in-process Mongo):
 *
 * guest x2 -> casual matchmaking pairs them -> sockets play wall/move ->
 * resign -> settle writes replay but NO ratings for guests -> guest chat
 * rejected -> convert upgrades in place (same id, history preserved) ->
 * converted account earns ratings; guests blocked from ranked/friends/clubs.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { io, type Socket } from 'socket.io-client';
import { buildApp } from '../app.js';
import { attachGameSocket } from '../realtime/sockets/gameSocket.js';
import { ensureIndexes } from '../database/mongodb/indexes.js';
import { getMongoDb, closeMongo, __resetMongoForTests } from '../database/mongodb/client.js';
import { closeRedis, __resetRedisForTests } from '../database/redis/client.js';
import { __resetAuthServiceForTests } from '../modules/auth/service.js';
import { GamesService } from '../modules/games/service.js';
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

async function api(jar: Jar, path: string, init: RequestInit = {}): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(jar.cookie !== '' ? { Cookie: jar.cookie } : {}), ...(init.headers ?? {}) },
  });
  storeCookies(jar, res);
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, body };
}

function post(jar: Jar, path: string, payload: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  return api(jar, path, { method: 'POST', body: JSON.stringify(payload) });
}

function waitForState(sock: Socket, gameId: string, predicate: (s: { moveCount: number; status: string }) => boolean, timeoutMs = 8000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      sock.off('game:state', onState);
      reject(new Error('timed out waiting for game state'));
    }, timeoutMs);
    const onState = (snap: { id: string; moveCount: number; status: string }) => {
      if (snap.id !== gameId) return;
      if (predicate(snap)) {
        clearTimeout(timer);
        sock.off('game:state', onState);
        resolve();
      }
    };
    sock.on('game:state', onState);
  });
}

function waitForError(sock: Socket, timeoutMs = 8000): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      sock.off('game:error', onErr);
      reject(new Error('timed out waiting for game:error'));
    }, timeoutMs);
    const onErr = (payload: { message?: string }) => {
      clearTimeout(timer);
      sock.off('game:error', onErr);
      resolve(payload.message ?? '');
    };
    sock.on('game:error', onErr);
  });
}

before(async () => {
  mongod = await MongoMemoryServer.create({ instance: { dbName: 'nexus_guest' } });
  process.env['MONGODB_URI'] = mongod.getUri();
  process.env['MONGODB_DB_NAME'] = 'nexus_guest';
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

describe('guest lifecycle', () => {
  it('guest creation, casual pairing, unrated settlement, chat gate, conversion', async () => {
    const jarA: Jar = { cookie: '' };
    const jarB: Jar = { cookie: '' };

    // Two ephemeral guests.
    const ga = await post(jarA, '/api/v1/auth/guest', {});
    assert.equal(ga.status, 200);
    const ua = ga.body['user'] as Record<string, unknown>;
    assert.equal(ua['guest'], true);
    assert.match(String(ua['username']), /^Guest_/);
    const meA = await api(jarA, '/api/v1/auth/me');
    assert.equal((meA.body['user'] as Record<string, unknown>)['guest'], true);

    const gb = await post(jarB, '/api/v1/auth/guest', {});
    assert.equal(gb.status, 200);

    // Ranked queue rejects guests; casual accepts.
    const ranked = await post(jarA, '/api/v1/matchmaking/join', { mode: 'ranked', timeControl: '3+1' });
    assert.ok(ranked.status >= 400);
    const qa = await post(jarA, '/api/v1/matchmaking/join', { mode: 'casual', timeControl: '3+0' });
    assert.equal(qa.status, 200);
    assert.equal(qa.body['status'], 'queued');
    const qb = await post(jarB, '/api/v1/matchmaking/join', { mode: 'casual', timeControl: '3+0' });
    assert.equal(qb.status, 200);
    assert.equal(qb.body['status'], 'matched');
    const gameId = String(qb.body['gameId']);
    const st = await api(jarA, '/api/v1/matchmaking/status');
    assert.equal(st.body['status'], 'matched');
    assert.equal(st.body['gameId'], gameId);

    // Guests cannot use identity features.
    const fr = await post(jarA, '/api/v1/friends/request', { username: 'someone' });
    assert.ok(fr.status >= 400);

    // Play over sockets: join + wall + move, then resign via REST.
    const sockA = io(base, { path: '/socket', auth: { userId: String(ua['id']) }, reconnection: false });
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('socket connect timeout')), 8000);
      sockA.on('connect', () => {
        clearTimeout(t);
        resolve();
      });
    });
    try {
      sockA.emit('game:join', { gameId });
      await waitForState(sockA, gameId, (s) => s.status === 'active');
      sockA.emit('game:wall', { gameId, action: { type: 'wall', wall: { r: 0, c: 3, orientation: 'h' } } });
      await waitForState(sockA, gameId, (s) => s.moveCount >= 1);

      // Guest chat is rejected (read allowed, send blocked).
      const errP = waitForError(sockA);
      sockA.emit('game:chat', { gameId, body: 'hello from guest' });
      const errMsg = await errP;
      assert.match(errMsg, /guest/i);
    } finally {
      sockA.disconnect();
    }

    const resign = await post(jarA, `/api/v1/games/${gameId}/resign`, {});
    assert.equal(resign.status, 200);

    // Settlement: replay persisted, but zero rating rows for the guest.
    const prof = await api(jarA, `/api/v1/profiles/${encodeURIComponent(String(ua['username']))}`);
    assert.equal(prof.status, 200);
    const ratings = prof.body['ratings'] as { mode: string; games: number }[];
    assert.ok(ratings.length > 0);
    for (const r of ratings) assert.equal(r.games, 0);

    // Conversion upgrades in place: same id, casual history preserved.
    const conv = await post(jarA, '/api/v1/auth/convert', {
      email: 'exguest@example.com',
      username: 'exguest',
      password: 's3cret-pass',
    });
    assert.equal(conv.status, 200);
    const cu = conv.body['user'] as Record<string, unknown>;
    assert.equal(cu['guest'], false);
    assert.equal(cu['id'], ua['id']);
    assert.equal(cu['username'], 'exguest');
    const after = await api(jarA, `/api/v1/profiles/exguest`);
    assert.equal(after.status, 200);
    const recent = after.body['recentGames'] as unknown[];
    assert.ok(recent.length >= 1);

    // Converted account can log in with the new credentials.
    const jarC: Jar = { cookie: '' };
    const login = await post(jarC, '/api/v1/auth/login', { login: 'exguest', password: 's3cret-pass' });
    assert.equal(login.status, 200);
  });

  it('waiting-game invite links expire after 24h', () => {
    const gs = new GamesService();
    const wg = gs.create({ creatorId: 'ghost-host', timeControl: '3+0', mode: 'casual' });
    assert.equal(wg.status, 'waiting');
    wg.createdAt = Date.now() - 25 * 60 * 60 * 1000;
    assert.throws(() => gs.join(wg.id, 'late-guest'), /expired/i);
    assert.equal(gs.get(wg.id).status, 'aborted');
  });
});
