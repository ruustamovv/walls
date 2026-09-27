/**
 * HTTP + WebSocket E2E against a real listening server (ephemeral port,
 * in-process Mongo, no external services required):
 *
 * register x2 -> matchmaking pair -> sockets join -> socket move ->
 * socket state broadcast -> REST wall -> resign -> ratings + replay +
 * review + leaderboard all observe the finished game.
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
  const set = typeof (res.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie === 'function'
    ? (res.headers as Headers & { getSetCookie: () => string[] }).getSetCookie()
    : [];
  for (const line of set) {
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

function waitForState(sock: Socket, gameId: string, predicate: (s: { moveCount: number; status: string }) => boolean, timeoutMs = 8000): Promise<{ moveCount: number; status: string; winnerSeat: number | null }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      sock.off('game:state', onState);
      reject(new Error('timed out waiting for game state'));
    }, timeoutMs);
    const onState = (snap: { id: string; moveCount: number; status: string; winnerSeat: number | null }) => {
      if (snap.id !== gameId) return;
      if (predicate(snap)) {
        clearTimeout(timer);
        sock.off('game:state', onState);
        resolve(snap);
      }
    };
    sock.on('game:state', onState);
  });
}

function connectSocket(userId: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const sock = io(base, { path: '/socket', auth: { userId }, reconnection: false });
    const timer = setTimeout(() => {
      sock.disconnect();
      reject(new Error('socket connect timeout'));
    }, 8000);
    sock.on('connect', () => {
      clearTimeout(timer);
      resolve(sock);
    });
    sock.on('connect_error', (err: Error) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

before(async () => {
  mongod = await MongoMemoryServer.create({ instance: { dbName: 'nexus_http' } });
  process.env['MONGODB_URI'] = mongod.getUri();
  process.env['MONGODB_DB_NAME'] = 'nexus_http';
  __resetMongoForTests();
  __resetAuthServiceForTests();
  await ensureIndexes(await getMongoDb());
  const built = await buildApp();
  app = built;
  sio = attachGameSocket(built.server);
  await built.listen({ port: 0, host: '127.0.0.1' });
  const addr = built.server.address() as AddressInfo;
  base = `http://127.0.0.1:${addr.port}`;
});

after(async () => {
  if (sio !== null) sio.close();
  if (app !== null) await app.close().catch(() => undefined);
  await closeMongo().catch(() => undefined);
  // The Redis probe singleton must not outlive the suite (same hang class
  // as the original verify:live bug: open handle = test process never exits).
  await closeRedis().catch(() => undefined);
  __resetMongoForTests();
  __resetRedisForTests();
  __resetAuthServiceForTests();
  if (mongod !== null) await mongod.stop().catch(() => undefined);
  mongod = null;
});

describe('http+socket flow: two clients play a rated game', () => {
  it('register -> match -> socket moves -> resign -> ratings/replay/review/leaderboard', async () => {
    const alice: Jar = { cookie: '' };
    const bob: Jar = { cookie: '' };

    const ra = await api(alice, '/api/v1/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email: 'alice@example.com', username: 'alice', password: 's3cret-pass' }),
    });
    assert.equal(ra.status, 200);
    const aliceId = ((ra.body['user'] as Record<string, string>)['id'] ?? '') as string;
    assert.ok(aliceId.length > 0);

    const rb = await api(bob, '/api/v1/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email: 'bob@example.com', username: 'bobby', password: 's3cret-pass' }),
    });
    assert.equal(rb.status, 200);
    const bobId = ((rb.body['user'] as Record<string, string>)['id'] ?? '') as string;

    const qa = await api(alice, '/api/v1/matchmaking/join', {
      method: 'POST',
      body: JSON.stringify({ mode: 'ranked', timeControl: '3+1' }),
    });
    assert.equal(qa.status, 200);
    assert.equal(qa.body['status'], 'queued');

    const qb = await api(bob, '/api/v1/matchmaking/join', {
      method: 'POST',
      body: JSON.stringify({ mode: 'ranked', timeControl: '3+1' }),
    });
    assert.equal(qb.status, 200);
    assert.equal(qb.body['status'], 'matched');
    const gameId = qb.body['gameId'] as string;
    assert.ok(typeof gameId === 'string' && gameId.length > 0);

    const sa = await api(alice, '/api/v1/matchmaking/status');
    assert.equal(sa.body['status'], 'matched');
    assert.equal(sa.body['gameId'], gameId);

    // Both clients connect over WebSocket and join the room.
    const aliceSock = await connectSocket(aliceId);
    const bobSock = await connectSocket(bobId);
    try {
      // Wait for each join echo first: the server emits game:state to the
      // joiner after adding it to the room, so this proves room membership
      // before any move is broadcast (kills the join/move race).
      const joinedA = waitForState(aliceSock, gameId, () => true);
      const joinedB = waitForState(bobSock, gameId, () => true);
      aliceSock.emit('game:join', { gameId });
      bobSock.emit('game:join', { gameId });
      await Promise.all([joinedA, joinedB]);

      // Alice moves her pawn via socket; Bob must observe move 1.
      const moved = waitForState(bobSock, gameId, (s) => s.moveCount >= 1);
      aliceSock.emit('game:move', { gameId, action: { type: 'move', to: { r: 1, c: 7 } } });
      const afterMove = await moved;
      assert.equal(afterMove.status, 'active');

      // Bob answers with a wall over REST (no socket fan-out by design);
      // Alice syncs via the authoritative read path.
      const wall = await api(bob, `/api/v1/games/${gameId}/move`, {
        method: 'POST',
        body: JSON.stringify({ type: 'wall', wall: { r: 1, c: 6, orientation: 'h' } }),
      });
      assert.equal(wall.status, 200);
      assert.equal(wall.body['moveCount'], 2);
      const snap = await api(alice, `/api/v1/games/${gameId}`);
      assert.equal((snap.body as Record<string, unknown>)['moveCount'], 2);

      // Bob resigns over the socket; both observe the terminal state.
      const finA = waitForState(aliceSock, gameId, (s) => s.status === 'finished');
      const finB = waitForState(bobSock, gameId, (s) => s.status === 'finished');
      bobSock.emit('game:resign', { gameId });
      const [fa, fb] = await Promise.all([finA, finB]);
      assert.equal(fa.winnerSeat, 0);
      assert.equal(fb.winnerSeat, 0);
    } finally {
      aliceSock.disconnect();
      bobSock.disconnect();
    }

    // Settlement is async on the socket path — poll until Mongo reflects it.
    let profile: Record<string, unknown> | null = null;
    for (let i = 0; i < 20; i++) {
      const p = await api(alice, '/api/v1/profiles/alice');
      const ratings = p.body['ratings'] as { mode: string; rating: number; games: number }[];
      const blitz = ratings.find((r) => r.mode === 'blitz');
      if (blitz !== undefined && blitz.games >= 1) {
        profile = p.body;
        break;
      }
      await new Promise((r) => setTimeout(r, 300));
    }
    assert.ok(profile !== null, 'settlement did not land in Mongo');
    const blitz = (profile['ratings'] as { mode: string; rating: number; games: number }[]).find((r) => r.mode === 'blitz');
    assert.ok(blitz !== undefined && blitz.rating > 1500, 'winner gains rating');

    const lb = await api(alice, '/api/v1/leaderboard?mode=blitz');
    const entries = lb.body['entries'] as { username: string }[];
    assert.ok(entries.some((e) => e.username === 'alice'));

    const replay = await api(alice, `/api/v1/replays/${gameId}`);
    assert.equal(replay.status, 200);
    assert.equal((replay.body['actions'] as unknown[]).length, 2);

    const review = await api(alice, `/api/v1/games/${gameId}/review`);
    assert.equal(review.status, 200);
    assert.equal((review.body['moves'] as unknown[]).length, 2);
    assert.ok(Array.isArray((review.body['summary'] as Record<string, unknown>)['score']));
  });
});
