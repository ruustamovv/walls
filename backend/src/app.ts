/**
 * Fastify app factory — cors, cookie, rate-limit, logging, error handler, routes.
 * Socket.io attaches to the underlying HTTP server in server.ts (not here),
 * so buildApp() stays pure and unit-testable without opening ports.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import { randomUUID } from 'node:crypto';
import { toErrorShape } from './common/errors/errors.js';
import { logger } from './common/logging/logger.js';
import { registerV1 } from './routes/v1.js';
import { checkMongoHealth } from './database/mongodb/health.js';
import { checkRedisHealth } from './database/redis/health.js';

export interface BuildAppOptions {
  loggerEnabled?: boolean;
}

export async function buildApp(opts: BuildAppOptions = {}): Promise<FastifyInstance> {
  // NOTE: Fastify v5 takes a *config object* for `logger`, not a pino
  // instance — pass our instance via `loggerInstance`.
  const app = Fastify({
    ...(opts.loggerEnabled === true
      ? { loggerInstance: logger as unknown as import('fastify').FastifyBaseLogger }
      : { logger: false as const }),
    requestIdHeader: 'x-request-id',
    genReqId: () => randomUUID(),
  });

  const origins = (process.env['CORS_ORIGINS'] ?? process.env['FRONTEND_URL'] ?? 'http://localhost:5173')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  await app.register(cors, { origin: origins, credentials: true });
  await app.register(cookie, {
    secret: process.env['COOKIE_SECRET'] ?? 'dev-cookie-secret-change-me',
  });
  await app.register(rateLimit, {
    global: false,
    max: Number(process.env['RATE_LIMIT_MAX'] ?? 100),
    timeWindow: Number(process.env['RATE_LIMIT_WINDOW_MS'] ?? 60_000),
  });

  app.setErrorHandler((err, req, reply) => {
    const requestId = (req.id as string | undefined) ?? 'unknown';
    const { status, body } = toErrorShape(err, requestId);
    void reply.status(status).send(body);
  });

  // Root probes (also mirrored under /api/v1).
  // /ready verifies MongoDB + Redis connectivity — no credentials exposed.
  app.get('/health', async () => ({ ok: true, service: 'nexus-backend' }));
  app.get('/ready', async () => {
    const [mongo, redis] = await Promise.all([checkMongoHealth(), checkRedisHealth()]);
    const ok = mongo.ok;
    return {
      ok,
      checks: {
        mongo: mongo.ok ? `OK (${mongo.latencyMs ?? 0}ms)` : `FAIL: ${mongo.error ?? 'unreachable'}`,
        redis: redis.ok ? `OK (${redis.latencyMs ?? 0}ms)` : 'DEGRADED: unreachable',
      },
    };
  });
  app.get('/live', async () => ({ ok: true }));

  await registerV1(app);

  return app;
}
