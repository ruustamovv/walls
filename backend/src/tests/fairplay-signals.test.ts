/**
 * Anti-cheat signals (FRP-002): pure detector unit tests + an HTTP test that
 * a scripted farming pattern (same pair, 5 rapid ranked wins) produces
 * moderation cases with evidence — and never an automatic ban.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { buildApp } from '../app.js';
import { ensureIndexes } from '../database/mongodb/indexes.js';
import { getMongoDb, closeMongo, __resetMongoForTests } from '../database/mongodb/client.js';
import { UserRepository } from '../database/mongodb/repositories/user.repository.js';
import { __resetAuthServiceForTests } from '../modules/auth/service.js';
import {
  detectRapidMoveStreak,
  detectSamePairWins,
  detectSandbagging,
  ModerationCaseRepository,
  RAPID_MOVE_STREAK_MIN,
  SAME_PAIR_WINS_MIN,
  SANDBAG_LOSS_STREAK_MIN,
} from '../modules/fairplay/signals.js';
import type { FastifyInstance } from 'fastify';
import type { GameDoc, RatingHistoryDoc } from '../database/mongodb/types.js';

let mongod: MongoMemoryServer | null = null;
let app: FastifyInstance | null = null;

function cookiesOf(res: { headers: Record<string, unknown> }): string {
  const set = res.headers['set-cookie'];
  const lines = Array.isArray(set) ? (set as string[]) : typeof set === 'string' ? [set] : [];
  const pair = lines.map((l) => l.split(';')[0]).find((p) => p?.startsWith('nexus_session='));
  return pair ?? '';
}

async function post(path: string, body: unknown, cookie = ''): Promise<{ status: number; json: Record<string, unknown>; headers: Record<string, unknown> }> {
  assert.ok(app !== null);
  const res = await app.inject({
    method: 'POST', url: path,
    payload: JSON.stringify(body),
    headers: { 'content-type': 'application/json', ...(cookie !== '' ? { cookie } : {}) },
  });
  return { status: res.statusCode, json: res.json() as Record<string, unknown>, headers: res.headers as Record<string, unknown> };
}

async function get(path: string, cookie = ''): Promise<{ status: number; json: Record<string, unknown> }> {
  assert.ok(app !== null);
  const res = await app.inject({ method: 'GET', url: path, headers: cookie !== '' ? { cookie } : {} });
  return { status: res.statusCode, json: res.json() as Record<string, unknown> };
}

async function register(email: string, username: string): Promise<string> {
  const res = await post('/api/v1/auth/register', { email, username, password: 's3cret-pass' });
  assert.equal(res.status, 200);
  return cookiesOf(res);
}

before(async () => {
  mongod = await MongoMemoryServer.create({ instance: { dbName: 'nexus_signals' } });
  process.env['MONGODB_URI'] = mongod.getUri();
  process.env['MONGODB_DB_NAME'] = 'nexus_signals';
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

describe('signal detectors (pure)', () => {
  it('rapid-move-streak flags only sustained sub-500ms runs', () => {
    const t = (n: number) => n * 100;
    // 3 moves, each 100ms apart -> streak of 3.
    assert.equal(detectRapidMoveStreak([t(0), t(1), t(2)])?.kind, 'rapid-move-streak');
    // 2 fast moves only -> below threshold.
    assert.equal(detectRapidMoveStreak([t(0), t(1)]), null);
    // 4 moves but a 2s gap in the middle -> best run is 2.
    assert.equal(detectRapidMoveStreak([t(0), t(1), t(2) + 2000, t(3) + 2100]), null);
    // 5 fast moves -> streak of 5 with evidence.
    const hit = detectRapidMoveStreak([t(0), t(1), t(2), t(3), t(4)]);
    assert.ok(hit !== null);
    assert.equal(hit.evidence['streakMoves'], 5);
    assert.equal(hit.evidence['thresholdMs'], 500);
    assert.ok(RAPID_MOVE_STREAK_MIN >= 3);
  });

  it('same-pair-ranked-wins counts consecutive ranked wins vs one opponent', () => {
    const game = (id: string, winnerSeat: number, mode = 'ranked'): GameDoc => ({
      _id: id, engineId: `g_${id}`, rulesVersion: '1', engineVersion: '1', mode,
      timeControl: '3+0', boardSize: 9, wallCount: 10,
      players: [
        { userId: 'farmer', seat: 0, usernameAtStart: 'farmer', ratingAtStart: 1000, clockMs: 1 },
        { userId: 'shill', seat: 1, usernameAtStart: 'shill', ratingAtStart: 1000, clockMs: 1 },
      ],
      status: 'FINISHED', result: { winnerSeat, reason: 'resign' },
      currentTurn: 0, moveCount: 3, createdAt: new Date(), version: 2,
    });
    const wins = [game('1', 0), game('2', 0), game('3', 0)];
    const hit = detectSamePairWins(wins, 'farmer');
    assert.ok(hit !== null);
    assert.equal(hit.kind, 'same-pair-ranked-wins');
    assert.equal(hit.evidence['streak'], 3);
    assert.equal(hit.evidence['opponentUserId'], 'shill');
    // Two wins then a loss resets the streak.
    const mixed = [game('1', 0), game('2', 0), game('3', 1), game('4', 0), game('5', 0)];
    assert.equal(detectSamePairWins(mixed, 'farmer'), null);
    // Casual games never count.
    const casual = [game('1', 0, 'casual'), game('2', 0, 'casual'), game('3', 0, 'casual')];
    assert.equal(detectSamePairWins(casual, 'farmer'), null);
    assert.ok(SAME_PAIR_WINS_MIN >= 3);
  });

  it('loss-streak-sandbagging flags consecutive ranked losses', () => {
    const loss = (i: number): RatingHistoryDoc => ({
      _id: String(i), userId: 'u', mode: 'blitz', gameId: `g${i}`,
      before: 1000 - i * 10, after: 990 - i * 10, createdAt: new Date(),
    });
    const history = [loss(0), loss(1), loss(2), loss(3), loss(4)];
    const hit = detectSandbagging(history);
    assert.ok(hit !== null);
    assert.equal(hit.kind, 'loss-streak-sandbagging');
    assert.equal(hit.evidence['streak'], 5);
    assert.ok((hit.evidence['ratingDrop'] as number) > 0);
    // A win resets the streak.
    const mixed: RatingHistoryDoc[] = [
      { ...loss(0) }, { ...loss(1) }, { ...loss(2) }, { ...loss(3) },
      { _id: 'w', userId: 'u', mode: 'blitz', gameId: 'gw', before: 960, after: 990, createdAt: new Date() },
      { ...loss(4) },
    ];
    assert.equal(detectSandbagging(mixed), null);
    assert.ok(SANDBAG_LOSS_STREAK_MIN >= 5);
  });
});

describe('moderation case repository', () => {
  it('opens, dedupes (repeatCount), lists and resolves cases', async () => {
    const db = await getMongoDb();
    const repo = new ModerationCaseRepository(db);
    const c1 = await repo.open({ userId: 'u1', kind: 'rapid-move-streak', summary: '3 fast moves', evidence: { streakMoves: 3 } });
    assert.equal(c1.status, 'OPEN');
    // Same user+kind bumps repeatCount instead of opening a second case.
    const c2 = await repo.open({ userId: 'u1', kind: 'rapid-move-streak', summary: '4 fast moves', evidence: { streakMoves: 4 } });
    assert.equal(c2._id, c1._id);
    assert.equal((c2.evidence['repeatCount'] as number), 2);
    const open = await repo.list('OPEN', 10);
    assert.equal(open.length, 1);
    assert.equal(await repo.resolve(c1._id, 'RESOLVED', 'reviewed: legitimate blitz player'), true);
    assert.equal((await repo.list('OPEN', 10)).length, 0);
    assert.equal((await repo.list('RESOLVED', 10)).length, 1);
  });
});

describe('farming pattern produces cases, never bans (HTTP)', () => {
  it('same pair + 5 rapid ranked wins -> signal cases in admin queue; account not banned', async () => {
    const farmerCookie = await register('farmer@e.com', 'thefarmer');
    const shillCookie = await register('shill@e.com', 'theshill');

    // Five rapid ranked games: 3 instant moves, then the shill resigns.
    for (let i = 0; i < 5; i++) {
      const created = await post('/api/v1/games', { timeControl: '3+0' }, farmerCookie);
      assert.equal(created.status, 200);
      const gameId = created.json['id'] as string;
      const joined = await post(`/api/v1/games/${gameId}/join`, {}, shillCookie);
      assert.equal(joined.status, 200);
      // Three sub-500ms moves (test executes in milliseconds).
      await post(`/api/v1/games/${gameId}/move`, { action: { type: 'move', to: { r: 1, c: 4 } } }, farmerCookie);
      await post(`/api/v1/games/${gameId}/move`, { action: { type: 'move', to: { r: 7, c: 4 } } }, shillCookie);
      await post(`/api/v1/games/${gameId}/move`, { action: { type: 'move', to: { r: 2, c: 4 } } }, farmerCookie);
      const resign = await post(`/api/v1/games/${gameId}/resign`, {}, shillCookie);
      assert.equal(resign.status, 200);
      assert.equal(resign.json['status'], 'finished');
      assert.equal(resign.json['winnerSeat'], 0);
    }

    // The settlement sweep is fire-and-forget: poll the admin queue.
    const adminCookie = await register('boss@e.com', 'theboss');
    const db = await getMongoDb();
    const users = new UserRepository(db);
    const boss = await users.findByUsername('theboss');
    assert.ok(boss !== null);
    assert.equal(await users.updateRole(boss._id, 'OWNER'), true);

    let cases: { _id: string; userId: string; kind: string; summary: string; evidence: Record<string, unknown>; status: string }[] = [];
    for (let i = 0; i < 40; i++) {
      const res = await get('/api/v1/admin/cases', adminCookie);
      assert.equal(res.status, 200);
      cases = res.json['cases'] as typeof cases;
      if (cases.length > 0) break;
      await new Promise((r) => setTimeout(r, 250));
    }
    assert.ok(cases.length > 0, 'expected at least one moderation case');
    const pairCase = cases.find((c) => c.kind === 'same-pair-ranked-wins' && c.userId !== undefined);
    assert.ok(pairCase !== undefined, 'expected a same-pair-ranked-wins case');
    assert.ok(Number(pairCase.evidence['streak']) >= 3);
    assert.equal(pairCase.status, 'OPEN');

    // Timing signal also fired (3 rapid moves per game).
    const timingCase = cases.find((c) => c.kind === 'rapid-move-streak');
    assert.ok(timingCase !== undefined, 'expected a rapid-move-streak case');

    // NEVER auto-banned: the farmer can still register a session and play.
    const me = await get('/api/v1/auth/me', farmerCookie);
    assert.equal(me.status, 200);
    const farmer = await users.findByUsername('thefarmer');
    assert.ok(farmer !== null);
    assert.equal(farmer.status, 'ACTIVE');
    const newGame = await post('/api/v1/games', { timeControl: '3+0' }, farmerCookie);
    assert.equal(newGame.status, 200);
  });
});
