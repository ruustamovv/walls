/**
 * Load soak (TST-005, report-only): boots the real stack (in-process Mongo,
 * real HTTP + sockets) and hammers it with concurrent players.
 *
 * Measures: REST move p50/p95, socket broadcast fan-out latency, matchmaking
 * throughput. Prints a table, exits 0 — thresholds live in the tracker,
 * not as CI gates (env-dependent).
 *
 *   pnpm --filter ./tests load
 */
import { MongoMemoryServer } from 'mongodb-memory-server';
import { io, type Socket } from 'socket.io-client';
import { buildApp } from '../../../backend/dist/app.js';
import { attachGameSocket } from '../../../backend/dist/realtime/sockets/gameSocket.js';
import { ensureIndexes } from '../../../backend/dist/database/mongodb/indexes.js';
import { getMongoDb, closeMongo, __resetMongoForTests } from '../../../backend/dist/database/mongodb/client.js';
import { closeRedis, __resetRedisForTests } from '../../../backend/dist/database/redis/client.js';
import { __resetAuthServiceForTests } from '../../../backend/dist/modules/auth/service.js';
import type { FastifyInstance } from 'fastify';
import type { AddressInfo } from 'node:net';

const CCU = Number(process.env['LOAD_CCU'] ?? 24);
const MOVES_EACH = Number(process.env['LOAD_MOVES'] ?? 6);

function pct(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] as number;
}

async function main(): Promise<void> {
  const mongod = await MongoMemoryServer.create({ instance: { dbName: 'load_soak' } });
  process.env['MONGODB_URI'] = mongod.getUri();
  process.env['MONGODB_DB_NAME'] = 'load_soak';
  __resetMongoForTests();
  __resetRedisForTests();
  __resetAuthServiceForTests();
  await ensureIndexes(await getMongoDb());
  const app: FastifyInstance = await buildApp();
  await app.listen({ port: 0, host: '127.0.0.1' });
  const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  const sio = attachGameSocket(app.server);

  const restLat: number[] = [];
  let matched = 0;

  async function post(cookie: string, path: string, payload: unknown): Promise<{ status: number; body: Record<string, unknown>; cookie: string }> {
    const t0 = Date.now();
    const res = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(cookie !== '' ? { Cookie: cookie } : {}) },
      body: JSON.stringify(payload),
    });
    restLat.push(Date.now() - t0);
    const set = res.headers.get('set-cookie') ?? '';
    const pair = set.split(';')[0] ?? '';
    return {
      status: res.status,
      body: (await res.json().catch(() => ({}))) as Record<string, unknown>,
      cookie: pair.startsWith('nexus_session=') ? pair : cookie,
    };
  }

  // Register CCU users, pair them via matchmaking.
  const users: { cookie: string; id: string }[] = [];
  for (let i = 0; i < CCU; i++) {
    const r = await post('', '/api/v1/auth/register', { email: `load${i}@example.com`, username: `loaduser${i}`, password: 's3cret-pass' });
    const me = await fetch(`${base}/api/v1/auth/me`, { headers: { Cookie: r.cookie } }).then((x) => x.json() as Promise<{ user: { id: string } }>);
    users.push({ cookie: r.cookie, id: me.user.id });
  }
  const gameIds: string[] = [];
  for (const u of users) {
    const r = await post(u.cookie, '/api/v1/matchmaking/join', { mode: 'casual', timeControl: '3+0' });
    if (r.body['status'] === 'matched') {
      matched++;
      gameIds.push(String(r.body['gameId']));
    }
  }
  for (const u of users) {
    const r = await fetch(`${base}/api/v1/matchmaking/status`, { headers: { Cookie: u.cookie } }).then((x) => x.json() as Promise<{ status: string; gameId?: string }>);
    if (r.status === 'matched' && r.gameId !== undefined && !gameIds.includes(r.gameId)) gameIds.push(r.gameId);
  }

  // Socket storm: every player joins + spams one wall + one chat; measure fan-out.
  const socks: Socket[] = [];
  const t0 = Date.now();
  await Promise.all(users.map(async (u, i) => {
    const gid = gameIds[i % Math.max(1, gameIds.length)];
    if (gid === undefined) return;
    const sock = io(base, { path: '/socket', auth: { userId: u.id }, reconnection: false });
    await new Promise<void>((resolve) => {
      sock.on('connect', () => resolve());
      setTimeout(() => resolve(), 5000);
    });
    socks.push(sock);
    sock.emit('game:chat', { gameId: gid, body: `hi ${i}` });
    sock.emit('game:join', { gameId: gid });
  }));
  await new Promise((r) => setTimeout(r, 1500));
  for (const s of socks) s.disconnect();
  const fanoutMs = Date.now() - t0;

  // REST move latency under no contention (fresh game per sample).
  for (let i = 0; i < Math.min(MOVES_EACH, users.length - 1); i += 2) {
    const a = users[i] as { cookie: string; id: string };
    const b = users[i + 1] as { cookie: string; id: string };
    const g = await post(a.cookie, '/api/v1/games', { timeControl: '3+0', opponentId: b.id });
    const gid = String(g.body['id']);
    const snap = await fetch(`${base}/api/v1/games/${gid}`, { headers: { Cookie: a.cookie } }).then((x) => x.json() as Promise<{ state: { pawns: { r: number; c: number }[] } }>);
    const p = snap.state.pawns[0] as { r: number; c: number };
    await post(a.cookie, `/api/v1/games/${gid}/move`, { type: 'move', to: { r: p.r + 1, c: p.c } });
  }

  restLat.sort((x, y) => x - y);
  console.log('--- load soak ---');
  console.log(`ccu: ${CCU} users, ${gameIds.length} games, matched-now: ${matched}`);
  console.log(`rest p50/p95/max: ${pct(restLat, 50)} / ${pct(restLat, 95)} / ${pct(restLat, 100)} ms over ${restLat.length} calls`);
  console.log(`socket storm (${socks.length} sockets join+chat): ${fanoutMs} ms wall`);
  console.log('thresholds (tracker): rest p95 < 500ms local; storm completes without disconnects.');

  await sio.close().catch(() => undefined);
  await app.close().catch(() => undefined);
  await closeRedis().catch(() => undefined);
  await closeMongo().catch(() => undefined);
  __resetMongoForTests();
  __resetRedisForTests();
  await mongod.stop().catch(() => undefined);
}

main().then(
  () => process.exit(0),
  (err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  },
);
