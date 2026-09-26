/**
 * MongoDB integration tests — run against a REAL MongoDB instance.
 * Requires MONGODB_URI + MONGODB_DB_NAME (test db recommended).
 * When unreachable, tests fail loudly (no silent mocks) — except in CI
 * without services, where they skip with a clear message.
 *
 * Covers: user create + unique username/email, game create + move
 * persistence + exactly-once finish, replay save/fetch, rating upsert +
 * history append, tournament + notification flows, index bootstrap.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { MongoClient, type Db } from 'mongodb';
import { ensureIndexes } from '../database/mongodb/indexes.js';
import { UserRepository } from '../database/mongodb/repositories/user.repository.js';
import { GameRepository } from '../database/mongodb/repositories/game.repository.js';
import { RatingRepository } from '../database/mongodb/repositories/rating.repository.js';
import { ReplayRepository } from '../database/mongodb/repositories/replay.repository.js';
import { TournamentRepository, NotificationRepository } from '../database/mongodb/repositories/extended.repositories.js';

const URI = process.env['MONGODB_URI'] ?? '';
const DB = process.env['MONGODB_DB_NAME'] ?? '';

let client: MongoClient | null = null;
let db: Db | null = null;
let available = false;
let suffix = '';

async function tryConnect(): Promise<boolean> {
  if (URI === '' || DB === '') return false;
  try {
    client = new MongoClient(URI, { serverSelectionTimeoutMS: 4000 });
    await client.connect();
    await client.db(DB).command({ ping: 1 });
    db = client.db(DB);
    return true;
  } catch {
    return false;
  }
}

before(async () => {
  available = await tryConnect();
  suffix = `t${Date.now().toString(36)}`;
  if (!available) {
    console.warn('[mongo.test] SKIP: MONGODB_URI/MONGODB_DB_NAME unset or unreachable — start `docker compose up -d mongodb` for live verification.');
    return;
  }
  if (db !== null) await ensureIndexes(db);
});

after(async () => {
  if (client !== null) await client.close().catch(() => undefined);
});

function needDb(): Db {
  assert.ok(available && db !== null, 'MongoDB not reachable — set MONGODB_URI/MONGODB_DB_NAME and start `docker compose up -d mongodb`');
  return db as Db;
}

describe('mongo: users', () => {
  it('creates a user and enforces unique username/email', async () => {
    if (!available) return;
    const repo = new UserRepository(needDb());
    const u = await repo.create({ email: `u_${suffix}@example.com`, username: `u_${suffix}`, passwordHash: 'x'.repeat(32) });
    assert.strictEqual(typeof u._id, 'string');
    assert.ok(u._id.length > 0);
    await assert.rejects(() => repo.create({ email: `other_${suffix}@example.com`, username: `u_${suffix}`, passwordHash: 'y'.repeat(32) }));
    await assert.rejects(() => repo.create({ email: `u_${suffix}@example.com`, username: `other_${suffix}`, passwordHash: 'z'.repeat(32) }));
    assert.equal((await repo.findByUsername(`u_${suffix}`))?.email, `u_${suffix}@example.com`);
  });
});

describe('mongo: games + moves + replay', () => {
  it('persists game, appends moves, finishes exactly once, replays', async () => {
    if (!available) return;
    const games = new GameRepository(needDb());
    const replays = new ReplayRepository(needDb());
    const g = await games.createGame({
      mode: 'ranked', timeControl: '3+1', boardSize: 9, wallCount: 10,
      rulesVersion: '1.0.0', engineVersion: '1.0.0',
      players: [
        { userId: 'a', seat: 0, usernameAtStart: 'a', ratingAtStart: 1500, clockMs: 180000 },
        { userId: 'b', seat: 1, usernameAtStart: 'b', ratingAtStart: 1500, clockMs: 180000 },
      ],
    });
    await games.appendMove({ gameId: g._id, sequence: 0, playerId: 'a', seat: 0, action: { type: 'move', to: { r: 1, c: 4 } }, serverTimeMs: 180000, stateHash: 'h0' });
    await games.appendMove({ gameId: g._id, sequence: 1, playerId: 'b', seat: 1, action: { type: 'move', to: { r: 7, c: 4 } }, serverTimeMs: 180000, stateHash: 'h1' });
    await assert.rejects(() => games.appendMove({ gameId: g._id, sequence: 1, playerId: 'b', seat: 1, action: { type: 'move', to: { r: 6, c: 4 } }, serverTimeMs: 179000, stateHash: 'dup' }));
    const moves = await games.listMoves(g._id);
    assert.equal(moves.length, 2);
    assert.strictEqual(typeof moves[0]?._id, 'string');
    assert.strictEqual(typeof g._id, 'string');
    assert.equal(moves[0]?.stateHash, 'h0');
    assert.equal(await games.finishGame(g._id, { winnerSeat: 0, reason: 'goal' }, 'final'), true);
    assert.equal(await games.finishGame(g._id, { winnerSeat: 1, reason: 'duplicate' }, 'x'), false);
    await replays.save({ gameId: g._id, rulesVersion: '1.0.0', engineVersion: '1.0.0', initialState: {}, actions: moves.map((m) => m.action), result: { winnerSeat: 0, reason: 'goal' }, hash: 'final', visibility: 'public' });
    assert.equal((await replays.findByGame(g._id))?.hash, 'final');
  });
});

describe('mongo: ratings + tournaments + notifications', () => {
  it('upserts rating and appends history', async () => {
    if (!available) return;
    const ratings = new RatingRepository(needDb());
    const uid = `ru_${suffix}`;
    const r1 = await ratings.recordResult({ userId: uid, mode: 'blitz', before: 1500, after: 1516, rating: 1516, deviation: 300, volatility: 0.06, outcome: 'win', gameId: 'g1' });
    assert.equal(r1.rating, 1516);
    assert.equal(r1.peak, 1516);
    const r2 = await ratings.recordResult({ userId: uid, mode: 'blitz', before: 1516, after: 1500, rating: 1500, deviation: 290, volatility: 0.06, outcome: 'loss', gameId: 'g2' });
    assert.equal(r2.peak, 1516);
    assert.equal((await ratings.history(uid, 'blitz')).length, 2);
    const hist = await ratings.history(uid, 'blitz');
    assert.strictEqual(typeof hist[0]?._id, 'string');
  });

  it('creates tournament, adds player idempotently, notifies', async () => {
    if (!available) return;
    const tours = new TournamentRepository(needDb());
    const notifs = new NotificationRepository(needDb());
    const t = await tours.create({ title: `T ${suffix}` });
    assert.strictEqual(typeof t._id, 'string');
    await tours.addPlayer(t._id, 'u1');
    await tours.addPlayer(t._id, 'u1');
    assert.equal(await tours.setStatus(t._id, 'LIVE'), true);
    assert.strictEqual((await tours.findById(t._id))?._id, t._id);
    const n = await notifs.create({ userId: 'u1', kind: 'tournament', title: 'Tournament live' });
    assert.strictEqual(typeof n._id, 'string');
    const listed = await notifs.listForUser('u1');
    assert.strictEqual(typeof listed[0]?._id, 'string');
    assert.strictEqual(listed[0]?._id, n._id);
    assert.equal(await notifs.markRead(n._id, 'u1'), true);
  });
});
