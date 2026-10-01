/**
 * Shared E2E harness: in-process Mongo, real Fastify app (inject) plus a
 * listening server for real socket.io clients. One boot per file.
 */
import { MongoMemoryServer } from 'mongodb-memory-server';
import { io, type Socket } from 'socket.io-client';
import type { FastifyInstance } from 'fastify';
import type { Server as SocketServer } from 'socket.io';
import type { AddressInfo } from 'node:net';
import { buildApp } from '../../../backend/dist/app.js';
import { attachGameSocket } from '../../../backend/dist/realtime/sockets/gameSocket.js';
import { ensureIndexes } from '../../../backend/dist/database/mongodb/indexes.js';
import { getMongoDb, closeMongo, __resetMongoForTests } from '../../../backend/dist/database/mongodb/client.js';
import { closeRedis, __resetRedisForTests } from '../../../backend/dist/database/redis/client.js';
import { __resetAuthServiceForTests } from '../../../backend/dist/modules/auth/service.js';

export interface World {
  mongod: MongoMemoryServer;
  app: FastifyInstance;
  sio: SocketServer;
  base: string;
}

export async function boot(dbName: string): Promise<World> {
  const mongod = await MongoMemoryServer.create({ instance: { dbName } });
  process.env['MONGODB_URI'] = mongod.getUri();
  process.env['MONGODB_DB_NAME'] = dbName;
  __resetMongoForTests();
  __resetRedisForTests();
  __resetAuthServiceForTests();
  await ensureIndexes(await getMongoDb());
  const app = await buildApp();
  await app.listen({ port: 0, host: '127.0.0.1' });
  const addr = app.server.address() as AddressInfo;
  const sio = attachGameSocket(app.server);
  return { mongod, app, sio, base: `http://127.0.0.1:${addr.port}` };
}

export async function shutdown(w: World): Promise<void> {
  await w.sio.close().catch(() => undefined);
  await w.app.close().catch(() => undefined);
  await closeRedis().catch(() => undefined);
  await closeMongo().catch(() => undefined);
  __resetMongoForTests();
  __resetRedisForTests();
  await w.mongod.stop().catch(() => undefined);
}

function cookieOf(headers: Record<string, unknown>): string {
  const set = headers['set-cookie'];
  const lines = Array.isArray(set) ? (set as string[]) : typeof set === 'string' ? [set] : [];
  return lines.map((l) => l.split(';')[0]).find((p) => p?.startsWith('nexus_session=')) ?? '';
}

export async function call(
  app: FastifyInstance,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  url: string,
  cookie: string,
  body?: unknown,
): Promise<{ status: number; json: Record<string, unknown>; body: Record<string, unknown>; cookie: string }> {
  const res = await app.inject({
    method,
    url,
    payload: body === undefined ? undefined : JSON.stringify(body),
    headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(cookie !== '' ? { cookie } : {}) },
  });
  const json = res.json() as Record<string, unknown>;
  return { status: res.statusCode, json, body: json, cookie: cookieOf(res.headers as Record<string, unknown>) || cookie };
}

export async function register(app: FastifyInstance, username: string): Promise<{ cookie: string; id: string }> {
  const res = await call(app, 'POST', '/api/v1/auth/register', '', {
    email: `${username}@example.com`,
    username,
    password: 's3cret-pass',
  });
  if (res.status !== 200) throw new Error(`register ${username} failed: ${res.status} ${JSON.stringify(res.json)}`);
  const me = await call(app, 'GET', '/api/v1/auth/me', res.cookie);
  const user = me.json['user'] as Record<string, unknown>;
  return { cookie: res.cookie, id: String(user['id']) };
}

export function connectSocket(base: string, userId: string): Promise<Socket> {
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

export function waitFor(
  sock: Socket,
  event: string,
  predicate: (payload: Record<string, unknown>) => boolean,
  timeoutMs = 8000,
): Promise<Record<string, unknown>> {
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
