/**
 * Online party games E2E (HTTP + sockets, in-process Mongo):
 *
 * 4 registered users -> multi quick-match bucket fills -> 4P game active ->
 * sockets play moves/walls across seats -> resign -> placement by distance,
 * replay persisted, ZERO rating writes (casual-only) -> invite expiry ->
 * waiting-game invite join seats a guest.
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
import { MultiGamesService } from '../modules/multiGames/service.js';
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

async function register(username: string): Promise<Jar> {
  const jar: Jar = { cookie: '' };
  const res = await post(jar, '/api/v1/auth/register', {
    email: `${username}@example.com`,
    username,
    password: 's3cret-pass',
  });
  assert.equal(res.status, 200);
  return jar;
}

function waitForMultiState(sock: Socket, gameId: string, predicate: (s: { moveCount: number; status: string }) => boolean, timeoutMs = 8000, tag = ''): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      sock.off('multi:state', onState);
      reject(new Error(`timed out waiting for multi:state [${tag}]`));
    }, timeoutMs);
    const onState = (snap: { id: string; moveCount: number; status: string }) => {
      if (snap.id !== gameId) return;
      if (predicate(snap)) {
        clearTimeout(timer);
        sock.off('multi:state', onState);
        resolve();
      }
    };
    sock.on('multi:state', onState);
  });
}

async function connectUserSocket(userId: string): Promise<Socket> {
  const sock = io(base, { path: '/socket', auth: { userId }, reconnection: false });
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('socket connect timeout')), 8000);
    sock.on('connect', () => {
      clearTimeout(t);
      resolve();
    });
  });
  return sock;
}

before(async () => {
  mongod = await MongoMemoryServer.create({ instance: { dbName: 'nexus_multi' } });
  process.env['MONGODB_URI'] = mongod.getUri();
  process.env['MONGODB_DB_NAME'] = 'nexus_multi';
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

describe('online party games', () => {
  it('4P quick-match fills, plays across seats, resigns with placement, no ratings', async () => {
    const jars = [await register('multia'), await register('multib'), await register('multic'), await register('multid')];
    const ids: string[] = [];
    for (const jar of jars) {
      const me = await api(jar, '/api/v1/auth/me');
      ids.push(String((me.body['user'] as Record<string, unknown>)['id']));
    }

    let gameId = '';
    for (let i = 0; i < jars.length; i++) {
      const res = await post(jars[i] as Jar, '/api/v1/matchmaking/multi/join', { players: 4, timeControl: '3+0' });
      assert.equal(res.status, 200);
      if (i < jars.length - 1) {
        assert.equal(res.body['status'], 'queued');
      } else {
        assert.equal(res.body['status'], 'matched');
        gameId = String(res.body['gameId']);
      }
    }
    for (let i = 0; i < jars.length - 1; i++) {
      const st = await api(jars[i] as Jar, '/api/v1/matchmaking/multi/status');
      assert.equal(st.body['status'], 'matched');
      assert.equal(st.body['gameId'], gameId);
    }

    const snap0 = await api(jars[0] as Jar, `/api/v1/multi/games/${gameId}`);
    assert.equal(snap0.status, 200);
    assert.equal((snap0.body['state'] as Record<string, unknown>)['players'], 4);
    assert.equal(snap0.body['status'], 'active');

    // Play one wall (seat 0) then one pawn move per other seat via sockets.
    const socks: Socket[] = [];
    const sockErrors: string[] = [];
    try {
      for (const id of ids) {
        const s = await connectUserSocket(id);
        s.on('game:error', (p: { message?: string }) => sockErrors.push(p.message ?? '?'));
        socks.push(s);
      }
      socks[0]?.emit('multi:join', { gameId });
      await waitForMultiState(socks[0] as Socket, gameId, (s) => s.status === 'active', 8000, 'join').catch((e) => {
        throw new Error(`join-wait failed (sockErrors: ${sockErrors.join(' | ') || 'none'})`, { cause: e });
      });
      // Every seat joins the room to receive broadcasts.
      for (const s of socks.slice(1)) {
        (s as Socket).emit('multi:join', { gameId });
      }
      (socks[0] as Socket).emit('multi:wall', { gameId, action: { type: 'wall', wall: { r: 2, c: 2, orientation: 'h' } } });
      await waitForMultiState(socks[0] as Socket, gameId, (s) => s.moveCount >= 1, 8000, 'wall').catch((e) => {
        throw new Error(`wall-wait failed (sockErrors: ${sockErrors.join(' | ') || 'none'})`, { cause: e });
      });
      // Seat 1 moves forward one step (deterministic legal opener on 9x9).
      (socks[1] as Socket).emit('multi:move', { gameId, action: { type: 'move', to: { r: 7, c: 4 } } });
      await waitForMultiState(socks[1] as Socket, gameId, (s) => s.moveCount >= 2, 8000, 'move').catch((e) => {
        throw new Error(`move-wait failed (sockErrors: ${sockErrors.join(' | ') || 'none'})`, { cause: e });
      });
    } finally {
      for (const s of socks) s.disconnect();
    }

    // Seat 2 resigns -> immediate finish with winner-first placement.
    const resign = await post(jars[2] as Jar, `/api/v1/multi/games/${gameId}/resign`, {});
    assert.equal(resign.status, 200);
    assert.equal(resign.body['status'], 'finished');
    const placement = resign.body['placement'] as number[];
    assert.equal(placement.length, 4);
    assert.deepEqual([...placement].sort((a, b) => a - b), [0, 1, 2, 3]);

    // Casual-only: no rating rows for any seat; replay persisted.
    const prof = await api(jars[0] as Jar, '/api/v1/profiles/multia');
    assert.equal(prof.status, 200);
    const ratings = prof.body['ratings'] as { mode: string; games: number }[];
    for (const r of ratings) assert.equal(r.games, 0);
    const db = await getMongoDb();
    const { ReplayRepository } = await import('../database/mongodb/repositories/replay.repository.js');
    const replay = await new ReplayRepository(db).findByGame(gameId);
    assert.ok(replay !== null);
    assert.ok((replay.actions?.length ?? 0) >= 2);
  });

  it('private party link seats players; stale invites expire', async () => {    const host = await register('partyhost');
    const created = await post(host, '/api/v1/multi/games', { players: 3, timeControl: '3+0' });
    assert.equal(created.status, 200);
    const gid = String(created.body['id']);
    assert.equal(created.body['status'], 'waiting');

    const friend = await register('partyfriend');
    const joined = await post(friend, `/api/v1/multi/games/${gid}/join`, {});
    assert.equal(joined.status, 200);
    // Still waiting for the third seat.
    assert.equal(joined.body['status'], 'waiting');

    const guest: Jar = { cookie: '' };
    const gg = await post(guest, '/api/v1/auth/guest', {});
    assert.equal(gg.status, 200);
    const gjoin = await post(guest, `/api/v1/multi/games/${gid}/join`, {});
    assert.equal(gjoin.status, 200);
    assert.equal(gjoin.body['status'], 'active');

    // Full table rejects extras.
    const extra = await register('partyextra');
    const full = await post(extra, `/api/v1/multi/games/${gid}/join`, {});
    assert.ok(full.status >= 400);

    // Stale waiting game expires.
    const svc = new MultiGamesService();
    const wg = svc.create({ creatorId: 'x', players: 2, timeControl: '3+0' });
    wg.createdAt = Date.now() - 25 * 60 * 60 * 1000;
    assert.throws(() => svc.join(wg.id, 'y'), /expired/i);
  });

  it('5P quick-match fills and starts on 19x19', async () => {
    const jars = [];
    for (const name of ['five_a', 'five_b', 'five_c', 'five_d', 'five_e']) {
      jars.push(await register(name));
    }
    let gameId = '';
    for (let i = 0; i < jars.length; i++) {
      const res = await post(jars[i] as Jar, '/api/v1/matchmaking/multi/join', { players: 5, timeControl: '3+0' });
      assert.equal(res.status, 200);
      if (i < jars.length - 1) {
        assert.equal(res.body['status'], 'queued');
      } else {
        assert.equal(res.body['status'], 'matched');
        gameId = String(res.body['gameId']);
      }
    }
    const snap = await api(jars[0] as Jar, `/api/v1/multi/games/${gameId}`);
    assert.equal(snap.status, 200);
    assert.equal(snap.body['players'], 5);
    assert.equal((snap.body['seats'] as unknown[]).length, 5);
    assert.equal((snap.body['state'] as Record<string, unknown>)['size'], 19);
    assert.equal(snap.body['status'], 'active');
    // Sixth player cannot squeeze in.
    const extra = await register('five_extra');
    const full = await post(extra, '/api/v1/matchmaking/multi/join', { players: 5, timeControl: '3+0' });
    assert.equal(full.status, 200);
    assert.equal(full.body['status'], 'queued');
  });

  it('6P quick-match fills and starts on 21x21', async () => {
    const jars = [];
    for (const name of ['six_a', 'six_b', 'six_c', 'six_d', 'six_e', 'six_f']) {
      jars.push(await register(name));
    }
    let gameId = '';
    for (let i = 0; i < jars.length; i++) {
      const res = await post(jars[i] as Jar, '/api/v1/matchmaking/multi/join', { players: 6, timeControl: '3+0' });
      assert.equal(res.status, 200);
      if (i < jars.length - 1) {
        assert.equal(res.body['status'], 'queued');
      } else {
        assert.equal(res.body['status'], 'matched');
        gameId = String(res.body['gameId']);
      }
    }
    const snap = await api(jars[0] as Jar, `/api/v1/multi/games/${gameId}`);
    assert.equal(snap.status, 200);
    assert.equal(snap.body['players'], 6);
    assert.equal((snap.body['seats'] as unknown[]).length, 6);
    assert.equal((snap.body['state'] as Record<string, unknown>)['size'], 21);
    assert.equal(snap.body['status'], 'active');
  });
});
