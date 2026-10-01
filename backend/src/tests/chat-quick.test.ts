/**
 * Ranked quick-chat gate (HTTP + sockets, in-process Mongo):
 * ranked 1v1 rejects free text but delivers presets; casual 1v1 still
 * delivers free text.
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

async function register(username: string): Promise<{ jar: Jar; id: string }> {
  const jar: Jar = { cookie: '' };
  const res = await post(jar, '/api/v1/auth/register', { email: `${username}@example.com`, username, password: 's3cret-pass' });
  assert.equal(res.status, 200);
  const me = await api(jar, '/api/v1/auth/me');
  return { jar, id: String((me.body['user'] as Record<string, unknown>)['id']) };
}

function connectUserSocket(userId: string): Promise<Socket> {
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
  });
}

function waitFor(sock: Socket, event: string, predicate: (p: Record<string, unknown>) => boolean, timeoutMs = 8000): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      sock.off(event, onEvent);
      reject(new Error(`timed out waiting for ${event}`));
    }, timeoutMs);
    const onEvent = (payload: Record<string, unknown>) => {
      if (predicate(payload)) {
        clearTimeout(timer);
        sock.off(event, onEvent);
        resolve(payload);
      }
    };
    sock.on(event, onEvent);
  });
}

before(async () => {
  mongod = await MongoMemoryServer.create({ instance: { dbName: 'nexus_quickchat' } });
  process.env['MONGODB_URI'] = mongod.getUri();
  process.env['MONGODB_DB_NAME'] = 'nexus_quickchat';
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

describe('ranked quick-chat gate', () => {
  it('rejects free text but delivers presets in ranked; casual stays free', async () => {
    const a = await register('quick_a');
    const b = await register('quick_b');

    // Ranked 1v1 via direct challenge game.
    const g = await post(a.jar, '/api/v1/games', { timeControl: '3+1', opponentId: b.id });
    assert.equal(g.status, 200);
    assert.equal(g.body['mode'], 'ranked');
    const gameId = String(g.body['id']);

    const sockA = await connectUserSocket(a.id);
    const sockB = await connectUserSocket(b.id);
    const errors: string[] = [];
    sockA.on('game:error', (p: { message?: string }) => errors.push(p.message ?? '?'));
    try {
      sockA.emit('game:join', { gameId });
      await waitFor(sockA, 'game:state', (s) => String(s['id']) === gameId);
      sockB.emit('game:join', { gameId });
      await waitFor(sockB, 'game:state', (s) => String(s['id']) === gameId);

      sockA.emit('game:chat', { gameId, body: 'watch out, I will wall f3 next' });
      await new Promise((r) => setTimeout(r, 300));
      assert.ok(errors.some((m) => /quick-chat/.test(m)), `expected quick-chat rejection, got: ${errors.join(' | ')}`);

      // Rejected sends still consume the 2s throttle window (anti-probe).
      await new Promise((r) => setTimeout(r, 2200));
      const heard = waitFor(sockB, 'game:chat', (m) => String(m['body']) === 'Good luck');
      sockA.emit('game:chat', { gameId, body: 'Good luck' });
      const msg = await heard;
      assert.equal(String(msg['from']), a.id);
    } finally {
      sockA.disconnect();
      sockB.disconnect();
    }

    // Casual 1v1 via matchmaking still delivers free text.
    const c = await register('quick_c');    const d = await register('quick_d');
    await post(c.jar, '/api/v1/matchmaking/join', { mode: 'casual', timeControl: '3+0' });
    const matched = await post(d.jar, '/api/v1/matchmaking/join', { mode: 'casual', timeControl: '3+0' });
    assert.equal(matched.body['status'], 'matched');
    const casualId = String(matched.body['gameId']);
    const sockC = await connectUserSocket(c.id);
    const sockD = await connectUserSocket(d.id);
    try {
      sockC.emit('game:join', { gameId: casualId });
      await waitFor(sockC, 'game:state', (s) => String(s['id']) === casualId);
      sockD.emit('game:join', { gameId: casualId });
      await waitFor(sockD, 'game:state', (s) => String(s['id']) === casualId);
      const heardFree = waitFor(sockD, 'game:chat', (m) => String(m['body']) === 'have fun, friend');
      sockC.emit('game:chat', { gameId: casualId, body: 'have fun, friend' });
      await heardFree;
    } finally {
      sockC.disconnect();
      sockD.disconnect();
    }
  });

  it('blocklisted chat is rejected and auto-flagged for staff', async () => {
    const a = await register('quick_e');
    const b = await register('quick_f');
    const g = await post(a.jar, '/api/v1/games', { timeControl: '3+0', opponentId: b.id });
    const gameId = String(g.body['id']);
    const sockA = await connectUserSocket(a.id);
    const errors: string[] = [];
    sockA.on('game:error', (p: { message?: string }) => errors.push(p.message ?? '?'));
    try {
      sockA.emit('game:join', { gameId });
      await waitFor(sockA, 'game:state', (s) => String(s['id']) === gameId);
      sockA.emit('game:chat', { gameId, body: 'you are such a fucker' });
      await new Promise((r) => setTimeout(r, 400));
      assert.ok(errors.some((m) => /auto-moderation/.test(m)), `expected block, got: ${errors.join(' | ')}`);
      const { getMongoDb } = await import('../database/mongodb/client.js');
      const { ReportRepository } = await import('../database/mongodb/repositories/social.repository.js');
      const open = await new ReportRepository(await getMongoDb()).list('OPEN', 50);
      assert.ok(open.some((r) => r.targetId === a.id && r.reason.includes('[auto-flag')), 'expected auto-flag report');
    } finally {
      sockA.disconnect();
    }
  });
});
