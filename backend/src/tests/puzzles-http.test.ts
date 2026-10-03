/**
 * Puzzle HTTP surface via app.inject (no ports): daily puzzle is served
 * without ever leaking the solution, and attempts require auth.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../app.js';
import { closeRedis, __resetRedisForTests } from '../database/redis/client.js';
import type { FastifyInstance } from 'fastify';

let app: FastifyInstance | null = null;

before(async () => {
  // No MONGODB_URI here on purpose: exercises the offline-degraded path.
  delete process.env['MONGODB_URI'];
  const { __resetMongoForTests } = await import('../database/mongodb/client.js');
  __resetMongoForTests();
  app = await buildApp();
});

after(async () => {
  if (app !== null) await app.close().catch(() => undefined);
  await closeRedis().catch(() => undefined);
  __resetRedisForTests();
});

describe('puzzles http', () => {
  it('serves the daily puzzle without leaking the solution', async () => {
    assert.ok(app !== null);
    const res = await app.inject({ method: 'GET', url: '/api/v1/puzzles/daily' });
    assert.equal(res.statusCode, 200);
    const body = res.json() as Record<string, unknown>;
    assert.ok(typeof body['puzzleId'] === 'string');
    assert.ok(Array.isArray((body as { pawns?: unknown[] }).pawns));
    assert.equal('solution' in body, false);
    assert.equal('solutionGain' in body, false);
  });

  it('rejects anonymous attempts with 401', async () => {
    assert.ok(app !== null);
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/puzzles/daily/attempt',
      payload: { wall: { r: 1, c: 1, orientation: 'h' } },
    });
    assert.equal(res.statusCode, 401);
  });

  it('reports AI status without secrets', async () => {
    assert.ok(app !== null);
    const res = await app.inject({ method: 'GET', url: '/api/v1/ai/status' });
    assert.equal(res.statusCode, 200);
    const body = res.json() as { providers: { keyHint: string | null }[] };
    for (const p of body.providers) {
      assert.ok(p.keyHint === null || p.keyHint.startsWith('••••'));
    }
  });

  it('serves public headline counters without auth', async () => {
    assert.ok(app !== null);
    const res = await app.inject({ method: 'GET', url: '/api/v1/stats/public' });
    assert.equal(res.statusCode, 200);
    const body = res.json() as { users: number; gamesToday: number };
    assert.ok(typeof body.users === 'number' && body.users >= 0);
    assert.ok(typeof body.gamesToday === 'number' && body.gamesToday >= 0);
    const again = await app.inject({ method: 'GET', url: '/api/v1/stats/public' });
    assert.deepEqual(again.json(), body);
  });
});
