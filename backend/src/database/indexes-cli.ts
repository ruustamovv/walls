/** `pnpm db:indexes` — ensure MongoDB indexes only. */
import '../config/env.js';
import { getMongoDb, closeMongo } from './mongodb/client.js';
import { ensureIndexes } from './mongodb/indexes.js';

async function main(): Promise<void> {
  const db = await getMongoDb();
  const created = await ensureIndexes(db);
  console.log(`[db:indexes] ensured ${created.length} indexes`);
  for (const c of created) console.log(`  - ${c}`);
  await closeMongo();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
