/**
 * Shared MongoDB client singleton.
 * - One MongoClient per process (never per-request).
 * - Lazy connect on first use; explicit close on shutdown.
 * - Secrets are never logged (URI is masked in errors).
 */
import { MongoClient, type Db } from 'mongodb';
import { logger } from '../../common/logging/logger.js';

let client: MongoClient | null = null;
let db: Db | null = null;
let connectPromise: Promise<Db> | null = null;

function maskUri(uri: string): string {
  // mongodb://user:pass@host/... -> mongodb://***@host/...
  return uri.replace(/\/\/([^@/\s]+)@/, '//***@');
}

function readConfig(): { uri: string; dbName: string } {
  const uri = process.env['MONGODB_URI'] ?? '';
  const dbName = process.env['MONGODB_DB_NAME'] ?? '';
  if (uri === '' || dbName === '') {
    throw new Error('Missing MONGODB_URI / MONGODB_DB_NAME (see .env.example)');
  }
  return { uri, dbName };
}

export async function getMongoDb(): Promise<Db> {
  if (db !== null) return db;
  if (connectPromise !== null) return connectPromise;
  connectPromise = (async () => {
    const { uri, dbName } = readConfig();
    const c = new MongoClient(uri, { maxPoolSize: 20, minPoolSize: 2, serverSelectionTimeoutMS: 8000 });
    try {
      await c.connect();
    } catch (err) {
      connectPromise = null;
      logger.error({ uri: maskUri(uri) }, 'MongoDB connect failed');
      throw err;
    }
    client = c;
    db = c.db(dbName);
    logger.info({ db: dbName }, 'MongoDB connected');
    return db;
  })();
  return connectPromise;
}

export function getMongoClient(): MongoClient | null {
  return client;
}

export async function closeMongo(): Promise<void> {
  connectPromise = null;
  db = null;
  if (client !== null) {
    try {
      await client.close();
    } catch {
      // ignore shutdown errors
    }
    client = null;
    logger.info('MongoDB disconnected');
  }
}

/** Test helper — reset singleton state. */
export function __resetMongoForTests(): void {
  connectPromise = null;
  db = null;
  client = null;
}
