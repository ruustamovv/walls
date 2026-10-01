/**
 * Server entry — MongoDB + Redis lifecycle, then HTTP + WebSocket.
 * Startup: env → Mongo → Redis → indexes → HTTP → WS → workers.
 * Shutdown: HTTP → matchmaking → sockets → workers → Redis → Mongo.
 */
import { buildApp } from './app.js';
import { loadEnv } from './config/env.js';
import { logger } from './common/logging/logger.js';
import { attachGameSocket } from './realtime/sockets/gameSocket.js';
import { connectDatabases, disconnectDb } from './database/client.js';
import { closeJobs } from './jobs/queue.js';

async function main(): Promise<void> {
  const env = loadEnv();
  await connectDatabases({ ensureIdx: true });
  const app = await buildApp({ loggerEnabled: true });

  const close = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'shutting down');
    try {
      await app.close();
    } catch (err) {
      logger.error({ err }, 'error during fastify close');
    }
    await closeJobs();
    await disconnectDb();
    process.exit(0);
  };
  process.on('SIGINT', () => void close('SIGINT'));
  process.on('SIGTERM', () => void close('SIGTERM'));

  await app.listen({ host: env.HOST, port: env.PORT });
  attachGameSocket(app.server);
  // Hourly recurrence sweep for daily/weekly tournament series (TRN-007).
  const sweepTimer = setInterval(() => {
    void import('./modules/tournaments/service.js')
      .then(({ sweepRecurrence }) => sweepRecurrence().catch((err: unknown) => logger.warn({ err }, 'recurrence sweep failed')))
      .catch(() => undefined);
  }, 60 * 60 * 1000);
  sweepTimer.unref?.();
  logger.info({ port: env.PORT, env: env.NODE_ENV }, 'backend listening (mongo+redis)');
}

main().catch((err: unknown) => {
  logger.error({ err }, 'fatal boot error');
  process.exit(1);
});
