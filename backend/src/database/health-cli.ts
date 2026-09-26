/**
 * `pnpm db:health` — prints MongoDB + Redis status. No secrets printed.
 * Exit 0 when Mongo is reachable; exit 1 otherwise.
 */
import '../config/env.js';
import { checkMongoHealth } from './mongodb/health.js';
import { checkRedisHealth } from './redis/health.js';
import { closeMongo } from './mongodb/client.js';
import { closeRedis } from './redis/client.js';

async function main(): Promise<void> {
  const mongo = await checkMongoHealth();
  const redis = await checkRedisHealth();
  const dbName = process.env['MONGODB_DB_NAME'] ?? '(unset)';
  console.log(`MongoDB connection: ${mongo.ok ? 'OK' : `FAIL (${mongo.error ?? 'unknown'})`}`);
  console.log(`MongoDB database: ${dbName}`);
  console.log(`Redis connection: ${redis.ok ? 'OK' : 'DEGRADED (unreachable)'}`);
  await closeRedis();
  await closeMongo();
  if (!mongo.ok) process.exit(1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
