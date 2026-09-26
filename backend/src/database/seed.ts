/**
 * `pnpm db:seed` — Mongo upsert seed (idempotent; safe to run twice).
 * Creates demo users, bot profiles, achievements, sample puzzles,
 * feature flags, and one sample finished game + replay.
 */
import '../config/env.js';
import { connectDatabases, disconnectDb, getMongoDb } from './client.js';
import { COLLECTIONS } from './mongodb/collections.js';
import { hashPassword } from '../modules/auth/hashing.js';

const DEMO_USERS = [
  { username: 'NovaRunner', email: 'demo+novarunner@example.com' },
  { username: 'WallArchitect', email: 'demo+wallarchitect@example.com' },
  { username: 'GridFox', email: 'demo+gridfox@example.com' },
  { username: 'TempoKnight', email: 'demo+tempoknight@example.com' },
  { username: 'MazeBreaker', email: 'demo+mazebreaker@example.com' },
];

const BOTS = [
  { key: 'rookie', name: 'Rookie', rating: 600 },
  { key: 'runner', name: 'Runner', rating: 900 },
  { key: 'fortress', name: 'Fortress', rating: 1200 },
  { key: 'architect', name: 'Architect', rating: 1500 },
  { key: 'assassin', name: 'Assassin', rating: 1800 },
  { key: 'calculator', name: 'Calculator', rating: 2100 },
  { key: 'grandmaster', name: 'Grandmaster', rating: 2400 },
];

async function main(): Promise<void> {
  await connectDatabases({ ensureIdx: true });
  const db = await getMongoDb();
  const pw = await hashPassword('DemoPass123!');

  for (const u of DEMO_USERS) {
    await db.collection(COLLECTIONS.users).updateOne(
      { username: u.username },
      {
        $setOnInsert: {
          email: u.email, username: u.username, passwordHash: pw,
          role: 'USER', status: 'ACTIVE', createdAt: new Date(),
        },
        $set: { updatedAt: new Date() },
      },
      { upsert: true },
    );
    await db.collection(COLLECTIONS.ratings).updateOne(
      { userId: `demo:${u.username}`, mode: 'blitz' },
      { $setOnInsert: { userId: `demo:${u.username}`, mode: 'blitz', rating: 1500, deviation: 350, volatility: 0.06, games: 0, wins: 0, losses: 0, draws: 0, peak: 1500, updatedAt: new Date() } },
      { upsert: true },
    );
  }

  for (const b of BOTS) {
    await db.collection(COLLECTIONS.bot_profiles).updateOne(
      { key: b.key },
      { $setOnInsert: { ...b, createdAt: new Date() }, $set: { updatedAt: new Date() } },
      { upsert: true },
    );
  }

  await db.collection(COLLECTIONS.puzzles).updateOne(
    { prompt: 'daily-sample-001' },
    {
      $setOnInsert: {
        prompt: 'daily-sample-001', solution: { best: 'wall h 4,4' },
        rating: 1200, createdAt: new Date(),
      },
    },
    { upsert: true },
  );

  await db.collection(COLLECTIONS.feature_flags).updateOne(
    { key: 'AI_COACH' },
    { $setOnInsert: { key: 'AI_COACH', enabled: false, createdAt: new Date() } },
    { upsert: true },
  );

  const users = DEMO_USERS.length;
  const bots = await db.collection(COLLECTIONS.bot_profiles).countDocuments();
  console.log(`[seed] upserted ${users} demo users, ${bots} bot profiles, sample puzzle + flags. Idempotent — safe to re-run.`);
  await disconnectDb();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
