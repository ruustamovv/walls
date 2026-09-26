/**
 * Database lifecycle — MongoDB (durable) + Redis (ephemeral).
 * Replaces the retired Prisma client singleton (see
 * docs/architecture/legacy-postgres-prisma-schema.md).
 *
 * Startup order: env → Mongo → Redis → indexes → HTTP/WS/workers.
 * Shutdown order: HTTP → matchmaking → sockets → workers → Redis → Mongo.
 */
import { getMongoDb, closeMongo } from './mongodb/client.js';
import { ensureIndexes } from './mongodb/indexes.js';
import { connectRedis, closeRedis } from './redis/client.js';
import { logger } from '../common/logging/logger.js';

export { getMongoDb, closeMongo } from './mongodb/client.js';
export { getRedis, closeRedis } from './redis/client.js';

export async function connectDatabases(opts: { ensureIdx?: boolean } = {}): Promise<void> {
  const db = await getMongoDb();
  if (opts.ensureIdx !== false) {
    const created = await ensureIndexes(db);
    logger.info({ indexes: created.length }, 'MongoDB indexes ensured');
  }
  const redisOk = await connectRedis();
  if (!redisOk) logger.warn('Booting without Redis — matchmaking/presence degraded');
}

/** Alias kept for server.ts readability. */
export async function disconnectDb(): Promise<void> {
  await closeRedis();
  await closeMongo();
}
