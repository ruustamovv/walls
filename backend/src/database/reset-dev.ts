/**
 * `pnpm db:reset:dev` — DEVELOPMENT ONLY.
 * Drops the dev database, recreates indexes. Refuses to run when
 * NODE_ENV=production or the DB name looks production-like.
 */
import '../config/env.js';
import { getMongoDb, closeMongo } from './mongodb/client.js';
import { ensureIndexes } from './mongodb/indexes.js';

async function main(): Promise<void> {
  const env = (process.env['NODE_ENV'] ?? 'development').toLowerCase();
  const dbName = process.env['MONGODB_DB_NAME'] ?? '';
  if (env === 'production' || /prod/i.test(dbName)) {
    console.error('[db:reset:dev] REFUSED: will not drop a production-like database. Aborting.');
    process.exit(1);
  }
  const db = await getMongoDb();
  await db.dropDatabase();
  console.log(`[db:reset:dev] dropped database "${db.databaseName}"`);
  await ensureIndexes(await getMongoDb());
  console.log('[db:reset:dev] indexes recreated. Run `pnpm db:seed` next.');
  await closeMongo();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
