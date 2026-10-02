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
import { getMultiLegalMoves, SIEGE_WALL_BONUS } from '../../../engine/typescript/dist/index.js';
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

describe('multi service: team mode (MLT-009)', () => {
  it('first seat home wins for its whole team; both sides are told', () => {
    const svc = new MultiGamesService();
    const g = svc.create({ creatorId: 'u0', players: 4, timeControl: '3+0', boardSize: 9, teamMode: true });
    assert.equal(g.teamMode, true);
    svc.join(g.id, 'u1');
    svc.join(g.id, 'u2'); // team 0 with seat 0
    svc.join(g.id, 'u3'); // team 1
    assert.equal(g.status, 'active');

    const live = (seat: number): { type: 'move'; to: { r: number; c: number } } => {
      const p = g.state.pawns[seat] as { r: number; c: number };
      if (seat === 0) return { type: 'move', to: p.c === 4 ? { r: 0, c: 3 } : { r: p.r + 1, c: 3 } };
      if (seat === 1) return { type: 'move', to: p.c === 4 ? { r: 8, c: 5 } : { r: 8, c: 4 } };
      if (seat === 2) return { type: 'move', to: p.c === 0 ? { r: 4, c: 1 } : { r: 4, c: 0 } };
      return { type: 'move', to: p.c === 8 ? { r: 4, c: 7 } : { r: 4, c: 8 } };
    };
    let guard = 0;
    while (g.status === 'active' && guard < 200) {
      const seat = g.state.turn;
      svc.play(g.id, g.playerIds[seat] ?? 'u0', live(seat));
      guard++;
    }
    assert.equal(g.status, 'finished');
    assert.equal(g.finishReason, 'goal');
    assert.equal(g.winnerSeat, 0, 'seat 0 reached home');
    const snap = svc.snapshot(g);
    assert.equal(snap.teamMode, true);
    assert.deepEqual(snap.teamOf, [0, 1, 0, 1]);
    assert.equal(snap.winningTeam, 0, 'team 0 (seats 0+2) wins');
    assert.equal(snap.placement[0], 0);
  });

  it('rejects team mode on odd seat counts and with continue-for-placement', () => {
    const svc = new MultiGamesService();
    assert.throws(() => svc.create({ creatorId: 'u0', players: 3, timeControl: '3+0', teamMode: true }), /2 or 4/);
    assert.throws(
      () => svc.create({ creatorId: 'u0', players: 4, timeControl: '3+0', teamMode: true, continueForPlacement: true }),
      /mutually exclusive/,
    );
    // Free-for-all snapshot stays team-free.
    const ffa = svc.create({ creatorId: 'u0', players: 4, timeControl: '3+0' });
    assert.equal(ffa.teamMode, false);
    assert.equal(svc.snapshot(ffa).teamOf, null);
    assert.equal(svc.snapshot(ffa).winningTeam, null);
  });
});

describe('multi service: continueForPlacement (MLT-007)', () => {
  it('opt-in game settles with full 1..N placement; default stays first-wins', () => {
    const svc = new MultiGamesService();
    const g = svc.create({ creatorId: 'u0', players: 3, timeControl: '3+0', boardSize: 9, continueForPlacement: true });
    assert.equal(g.continueForPlacement, true);
    svc.join(g.id, 'u1');
    svc.join(g.id, 'u2');
    assert.equal(g.status, 'active');

    const live = (seat: number): { type: 'move'; to: { r: number; c: number } } => {
      const p = g.state.pawns[seat] as { r: number; c: number };
      if (seat === 0) {
        if (g.state.eliminated.includes(0)) return { type: 'move', to: p };
        return { type: 'move', to: { r: p.r + 1, c: 4 } };
      }
      if (seat === 1) {
        if (g.state.eliminated.includes(1)) return { type: 'move', to: p };
        if (!g.state.eliminated.includes(0)) return { type: 'move', to: p.c === 0 ? { r: 4, c: 1 } : { r: 4, c: 0 } };
        return { type: 'move', to: p.r === 4 ? { r: 5, c: p.c } : { r: 5, c: p.c + 1 } };
      }
      if (g.state.eliminated.includes(2)) return { type: 'move', to: p };
      if (!g.state.eliminated.includes(1)) return { type: 'move', to: p.c === 8 ? { r: 4, c: 7 } : { r: 4, c: 8 } };
      return { type: 'move', to: { r: 4, c: p.c - 1 } };
    };

    let guard = 0;
    while (guard < 300) {
      if (g.status !== 'active') break;
      const seat = g.state.turn;
      const uid = g.playerIds[seat] ?? 'u0';
      svc.play(g.id, uid, live(seat));
      guard++;
    }
    assert.equal(g.status, 'finished');
    assert.equal(g.finishReason, 'goal');
    assert.deepEqual(g.placement, [0, 1, 2]);
    assert.equal(g.winnerSeat, 0);
    const snap = svc.snapshot(g);
    assert.deepEqual(snap.placement, [0, 1, 2]);
    assert.deepEqual(snap.eliminated, [0, 1, 2]);
    assert.equal(snap.continueForPlacement, true);
  });

  it('default game still ends at the first goal with distance placement', () => {
    const svc = new MultiGamesService();
    const g = svc.create({ creatorId: 'u0', players: 3, timeControl: '3+0', boardSize: 9 });
    assert.equal(g.continueForPlacement, false);
    svc.join(g.id, 'u1');
    svc.join(g.id, 'u2');
    // Seat 0 (S) walks straight down column 4 to the goal.
    for (let r = 1; r <= 8 && g.status === 'active'; r++) {
      svc.play(g.id, 'u0', { type: 'move', to: { r, c: 4 } });
      // Other seats shuffle legally so turns keep rotating.
      if (g.status !== 'active') break;
      const p1 = g.state.pawns[1] as { r: number; c: number };
      svc.play(g.id, 'u1', { type: 'move', to: p1.c === 0 ? { r: 4, c: 1 } : { r: 4, c: 0 } });
      if (g.status !== 'active') break;
      const p2 = g.state.pawns[2] as { r: number; c: number };
      svc.play(g.id, 'u2', { type: 'move', to: p2.c === 8 ? { r: 4, c: 7 } : { r: 4, c: 8 } });
    }
    assert.equal(g.status, 'finished');
    assert.equal(g.finishReason, 'goal');
    assert.equal(g.winnerSeat, 0);
    assert.equal(g.placement.length, 3);
    assert.equal(g.state.eliminated.length, 0);
  });
});

describe('multi service: fog of war (MLT-009)', () => {
  it('each seat receives only its own visible walls', () => {
    const svc = new MultiGamesService();
    const g = svc.create({ creatorId: 'u0', players: 4, timeControl: '3+0', boardSize: 9, fog: true });
    assert.equal(g.fog, true);
    svc.join(g.id, 'u1');
    svc.join(g.id, 'u2');
    svc.join(g.id, 'u3');

    // Seat 3 places a wall far from seat 0's pawn.
    svc.play(g.id, 'u0', { type: 'move', to: { r: 0, c: 3 } });
    svc.play(g.id, 'u1', { type: 'move', to: { r: 7, c: 4 } });
    svc.play(g.id, 'u2', { type: 'move', to: { r: 4, c: 1 } });
    svc.play(g.id, 'u3', { type: 'wall', wall: { r: 6, c: 6, orientation: 'h' } });
    assert.equal(g.state.walls.length, 1, 'the wall really exists');

    // Authoritative state keeps it; every projection hides it.
    const seat0 = svc.snapshot(g, 0);
    assert.equal(seat0.state.walls.length, 0, 'seat 0 cannot see the far wall');
    assert.equal(seat0.hiddenWalls, 1);
    assert.equal(g.state.walls.length, 1, 'server truth unchanged by projection');

    // A spectator / unknown viewer gets nothing, never the full board.
    const spectator = svc.snapshot(g, null);
    assert.equal(spectator.state.walls.length, 0);
    // Out-of-range seat index is treated as spectator, not as "reveal all".
    assert.equal(svc.snapshot(g, 99).state.walls.length, 0);
  });

  it('a wall becomes visible to the seat whose pawn it neighbours', () => {
    const svc = new MultiGamesService();
    const g = svc.create({ creatorId: 'u0', players: 4, timeControl: '3+0', boardSize: 9, fog: true });
    svc.join(g.id, 'u1');
    svc.join(g.id, 'u2');
    svc.join(g.id, 'u3');
    svc.play(g.id, 'u0', { type: 'move', to: { r: 0, c: 3 } });
    svc.play(g.id, 'u1', { type: 'move', to: { r: 7, c: 4 } });
    svc.play(g.id, 'u2', { type: 'move', to: { r: 4, c: 1 } });
    // Wall {0,2,h} separates (0,2)-(1,2): adjacent to seat 0 at (0,3).
    svc.play(g.id, 'u3', { type: 'wall', wall: { r: 0, c: 2, orientation: 'h' } });

    assert.equal(svc.snapshot(g, 0).state.walls.length, 1, 'seat 0 sees the adjacent wall');
    assert.equal(svc.snapshot(g, 0).hiddenWalls, 0);
    assert.equal(svc.snapshot(g, 2).state.walls.length, 0, 'seat 2 is still fogged');
    assert.equal(svc.snapshot(g, 2).hiddenWalls, 1);
  });

  it('non-fog games are unaffected: everyone sees the whole board', () => {
    const svc = new MultiGamesService();
    const g = svc.create({ creatorId: 'u0', players: 4, timeControl: '3+0', boardSize: 9 });
    assert.equal(g.fog, false);
    svc.join(g.id, 'u1');
    svc.join(g.id, 'u2');
    svc.join(g.id, 'u3');
    svc.play(g.id, 'u0', { type: 'move', to: { r: 0, c: 3 } });
    svc.play(g.id, 'u1', { type: 'move', to: { r: 7, c: 4 } });
    svc.play(g.id, 'u2', { type: 'move', to: { r: 4, c: 1 } });
    svc.play(g.id, 'u3', { type: 'wall', wall: { r: 6, c: 6, orientation: 'h' } });
    for (const seat of [0, 1, 2, 3, null]) {
      assert.equal(svc.snapshot(g, seat).state.walls.length, 1, 'full board for everyone');
      assert.equal(svc.snapshot(g, seat).hiddenWalls, 0);
    }
  });
});

describe('multi service: chaos + siege (MLT-009)', () => {
  it('chaos seeds itself so replays stay reproducible', () => {
    const svc = new MultiGamesService();
    const a = svc.create({ creatorId: 'u0', players: 4, timeControl: '3+0', boardSize: 9, chaos: true });
    const b = svc.create({ creatorId: 'u0', players: 4, timeControl: '3+0', boardSize: 9, chaos: true });
    assert.equal(a.chaos, true);
    assert.ok(typeof a.state.seed === 'number', 'a seed is always present');
    const snap = svc.snapshot(a);
    assert.equal(snap.chaos, true);
    assert.ok(typeof b.state.seed === 'number');
    // An explicit seed is honoured exactly.
    const seeded = svc.create({ creatorId: 'u0', players: 4, timeControl: '3+0', boardSize: 9, chaos: true, seed: 4242 });
    assert.equal(seeded.state.seed, 4242);
  });

  it('chaos conserves the wall budget while rotating it', () => {
    const svc = new MultiGamesService();
    const g = svc.create({ creatorId: 'u0', players: 4, timeControl: '3+0', boardSize: 9, chaos: true, seed: 9 });
    svc.join(g.id, 'u1');
    svc.join(g.id, 'u2');
    svc.join(g.id, 'u3');
    const base = 4 * 5;
    assert.equal(g.state.wallsRemaining.reduce((x, y) => x + y, 0), base);
    // Seat 0 walls; everyone else takes any legal step.
    svc.play(g.id, 'u0', { type: 'wall', wall: { r: 2, c: 2, orientation: 'h' } });
    let guard = 0;
    while (!g.state.isOver && guard < 12) {
      const seat = g.state.turn;
      const moves = getMultiLegalMoves(g.state, seat);
      if (moves.length === 0) break;
      svc.play(g.id, g.playerIds[seat] ?? 'u0', { type: 'move', to: moves[0] as { r: number; c: number } });
      guard++;
    }
    const total = g.state.wallsRemaining.reduce((x, y) => x + y, 0);
    assert.equal(total, base - g.state.walls.length, 'rotation never mints or destroys walls');
  });

  it('siege gives seat 0 the head start and the wall bonus', () => {
    const svc = new MultiGamesService();
    const g = svc.create({ creatorId: 'u0', players: 2, timeControl: '3+0', boardSize: 9, wallsPerPlayer: 10, siege: true });
    assert.equal(g.siege, true);
    assert.deepEqual(g.state.pawns[0], { r: 1, c: 4 });
    assert.deepEqual(g.state.pawns[1], { r: 8, c: 4 });
    assert.equal(g.state.wallsRemaining[0], 10 + SIEGE_WALL_BONUS);
    assert.equal(g.state.wallsRemaining[1], 10);
    assert.equal(svc.snapshot(g).siege, true);
  });

  it('all four modes default off, so existing games are unchanged', () => {
    const svc = new MultiGamesService();
    const g = svc.create({ creatorId: 'u0', players: 4, timeControl: '3+0', boardSize: 9 });
    const snap = svc.snapshot(g);
    assert.deepEqual(
      [snap.fog, snap.chaos, snap.siege, snap.teamMode, snap.continueForPlacement],
      [false, false, false, false, false],
    );
    assert.deepEqual(g.state.pawns[0], { r: 0, c: 4 }, 'no siege head start by default');
    assert.deepEqual(g.state.wallsRemaining, [5, 5, 5, 5], 'no wall bonus by default');
  });
});
