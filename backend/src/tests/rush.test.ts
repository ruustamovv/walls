/**
 * Puzzle Rush: deterministic seeds, server grading, solve recording,
 * stats + leaders — in-process Mongo, app.inject for HTTP.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { buildApp } from '../app.js';
import { ensureIndexes } from '../database/mongodb/indexes.js';
import { getMongoDb, closeMongo, __resetMongoForTests } from '../database/mongodb/client.js';
import { __resetAuthServiceForTests } from '../modules/auth/service.js';
import type { FastifyInstance } from 'fastify';

let mongod: MongoMemoryServer | null = null;
let app: FastifyInstance | null = null;

function cookieOf(res: { headers: Record<string, unknown> }): string {
  const set = res.headers['set-cookie'];
  const lines = Array.isArray(set) ? (set as string[]) : typeof set === 'string' ? [set] : [];
  return lines.map((l) => l.split(';')[0]).find((p) => p?.startsWith('nexus_session=')) ?? '';
}

async function register(email: string, username: string): Promise<string> {
  assert.ok(app !== null);
  const res = await app.inject({
    method: 'POST', url: '/api/v1/auth/register',
    payload: JSON.stringify({ email, username, password: 's3cret-pass' }),
    headers: { 'content-type': 'application/json' },
  });
  assert.equal(res.statusCode, 200);
  return cookieOf(res as unknown as { headers: Record<string, unknown> });
}

before(async () => {
  mongod = await MongoMemoryServer.create({ instance: { dbName: 'nexus_rush' } });
  process.env['MONGODB_URI'] = mongod.getUri();
  process.env['MONGODB_DB_NAME'] = 'nexus_rush';
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

describe('puzzle rush', () => {
  it('serves deterministic seeds without solutions, grades honestly', async () => {
    assert.ok(app !== null);
    const cookie = await register('rush@e.com', 'rusher');
    const a = await app.inject({ method: 'GET', url: '/api/v1/puzzles/rush/next?i=0' });
    assert.equal(a.statusCode, 200);
    const pa = a.json() as Record<string, unknown>;
    assert.equal('solution' in pa, false);
    assert.equal(typeof pa['seed'], 'string');
    const b = await app.inject({ method: 'GET', url: '/api/v1/puzzles/rush/next?i=0' });
    assert.deepEqual((b.json() as Record<string, unknown>)['seed'], pa['seed']);

    // Illegal wall fails without recording.
    const bad = await app.inject({
      method: 'POST', url: '/api/v1/puzzles/rush/attempt',
      payload: JSON.stringify({ seed: pa['seed'], wall: { r: 8, c: 8, orientation: 'h' } }),
      headers: { 'content-type': 'application/json', cookie },
    });
    assert.equal(bad.statusCode, 200);
    assert.equal((bad.json() as { legal: boolean }).legal, false);

    // Anonymous attempts are rejected.
    const anon = await app.inject({
      method: 'POST', url: '/api/v1/puzzles/rush/attempt',
      payload: JSON.stringify({ seed: pa['seed'], wall: { r: 1, c: 1, orientation: 'h' } }),
      headers: { 'content-type': 'application/json' },
    });
    assert.equal(anon.statusCode, 401);
  });

  it('records solves once and reports stats + leaders', async () => {
    assert.ok(app !== null);
    const cookie = await register('rush2@e.com', 'rusher2');
    const { seededPuzzle } = await import('../../../engine/typescript/dist/puzzles/index.js');
    const { todayKey } = await import('../../../engine/typescript/dist/puzzles/index.js');
    const seed = `rush-${todayKey()}-0-0`;
    let puzzle;
    try {
      puzzle = seededPuzzle(seed, seed, todayKey());
    } catch {
      // Fallback: use whatever the endpoint serves for i=0.
      const r = await app.inject({ method: 'GET', url: '/api/v1/puzzles/rush/next?i=0' });
      const body = r.json() as { seed: string };
      const { seededPuzzle: sp } = await import('../../../engine/typescript/dist/puzzles/index.js');
      puzzle = sp(body.seed, body.seed, todayKey());
    }
    const attempt = (wall: unknown, jar: string) => app!.inject({
      method: 'POST', url: '/api/v1/puzzles/rush/attempt',
      payload: JSON.stringify({ seed: puzzle.puzzleId, wall }),
      headers: { 'content-type': 'application/json', cookie: jar },
    });
    const good = await attempt({ ...puzzle.solution }, cookie);
    assert.equal(good.statusCode, 200);
    assert.equal((good.json() as { solved: boolean }).solved, true);
    // Re-solving the same seed stays solved (idempotent, farmed once).
    const again = await attempt({ ...puzzle.solution }, cookie);
    assert.equal((again.json() as { solved: boolean }).solved, true);

    const stats = await app.inject({ method: 'GET', url: '/api/v1/puzzles/rush/stats', headers: { cookie } });
    assert.equal(stats.statusCode, 200);
    const body = stats.json() as { mine: number; today: number; leaders: { username: string }[] };
    assert.equal(body.mine, 1);
    assert.equal(body.today, 1);
    assert.ok(body.leaders.some((l) => l.username === 'rusher2'));
  });
});
