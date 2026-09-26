/**
 * `pnpm db:setup` — connect Mongo + Redis, ensure indexes, report.
 * Idempotent; safe to run on every deploy.
 */
import '../config/env.js';
import { connectDatabases, disconnectDb } from './client.js';
import { checkMongoHealth } from './mongodb/health.js';
import { checkRedisHealth } from './redis/health.js';

async function main(): Promise<void> {
  await connectDatabases({ ensureIdx: true });
  const mongo = await checkMongoHealth();
  const redis = await checkRedisHealth();
  console.log(`MongoDB: ${mongo.ok ? `OK (${mongo.database}, ${mongo.latencyMs}ms)` : `FAIL: ${mongo.error}`}`);
  console.log(`Redis: ${redis.ok ? `OK (${redis.latencyMs}ms)` : 'DEGRADED: unreachable'}`);
  await disconnectDb();
  if (!mongo.ok) process.exit(1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
