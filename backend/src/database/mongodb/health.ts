/**
 * MongoDB health probe — connectivity + database name.
 * Never includes credentials or full URIs in output.
 */
import { getMongoDb } from './client.js';

export interface MongoHealth {
  ok: boolean;
  database?: string;
  latencyMs?: number;
  error?: string;
}

export async function checkMongoHealth(): Promise<MongoHealth> {
  const started = Date.now();
  try {
    const db = await getMongoDb();
    await db.command({ ping: 1 });
    return { ok: true, database: db.databaseName, latencyMs: Date.now() - started };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'unknown' };
  }
}
