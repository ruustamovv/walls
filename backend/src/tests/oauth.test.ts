/**
 * OAuth surface: provider status shape, unknown-provider rejection,
 * callback guards — all without touching provider networks.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../app.js';
import { closeRedis, __resetRedisForTests } from '../database/redis/client.js';
import type { FastifyInstance } from 'fastify';

let app: FastifyInstance | null = null;

before(async () => {
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

describe('oauth routes', () => {
  it('reports provider availability without secrets', async () => {
    assert.ok(app !== null);
    const res = await app.inject({ method: 'GET', url: '/api/v1/auth/oauth/status' });
    assert.equal(res.statusCode, 200);
    const body = res.json() as { google: boolean; github: boolean };
    assert.equal(typeof body.google, 'boolean');
    assert.equal(typeof body.github, 'boolean');
  });

  it('rejects unknown providers', async () => {
    assert.ok(app !== null);
    assert.equal((await app.inject({ method: 'GET', url: '/api/v1/auth/oauth/apple' })).statusCode, 400);
    assert.equal((await app.inject({ method: 'GET', url: '/api/v1/auth/oauth/apple/callback?code=x&state=y' })).statusCode, 400);
  });

  it('redirects unconfigured providers instead of crashing', async () => {
    assert.ok(app !== null);
    // No keys in this env: authorize raises ValidationError (400 JSON).
    const res = await app.inject({ method: 'GET', url: '/api/v1/auth/oauth/google?next=/play' });
    assert.equal(res.statusCode, 400);
  });

  it('callback without code/state bounces to login', async () => {
    assert.ok(app !== null);
    const res = await app.inject({ method: 'GET', url: '/api/v1/auth/oauth/github/callback' });
    assert.equal(res.statusCode, 302);
    assert.ok(String(res.headers['location']).includes('/login'));
  });

  it('callback with bogus state bounces to login', async () => {
    assert.ok(app !== null);
    const res = await app.inject({ method: 'GET', url: '/api/v1/auth/oauth/github/callback?code=x&state=nope' });
    assert.equal(res.statusCode, 302);
    assert.ok(String(res.headers['location']).includes('/login'));
  });
});
