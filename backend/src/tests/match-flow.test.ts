/**
 * Full match loop against an in-process Mongo (no external services):
 * register two users (Mongo-backed) -> matchmaking pairs them -> game
 * created -> pawn moves + wall -> resign -> settle writes ratings + replay
 * + finished game doc. Proves the competitive core end to end.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { getLegalMoves } from '../../../engine/typescript/dist/index.js';
import { AuthService } from '../modules/auth/service.js';
import { MongoUserStore } from '../modules/auth/store.js';
import { UserRepository } from '../database/mongodb/repositories/user.repository.js';
import { RatingRepository } from '../database/mongodb/repositories/rating.repository.js';
import { ReplayRepository } from '../database/mongodb/repositories/replay.repository.js';
import { GameRepository } from '../database/mongodb/repositories/game.repository.js';
import { ensureIndexes } from '../database/mongodb/indexes.js';
import { getMongoDb, closeMongo, __resetMongoForTests } from '../database/mongodb/client.js';
import { GamesService } from '../modules/games/service.js';
import { settleFinishedGame, ratingModeFor } from '../modules/games/finish.js';
import { persistGameCreated, persistMoveAppended, persistGameFinished } from '../modules/games/persistence.js';
import { InMemoryQueueStore, MatchmakingQueue } from '../modules/matchmaking/queue.js';

let mongod: MongoMemoryServer | null = null;

before(async () => {
  mongod = await MongoMemoryServer.create({ instance: { dbName: 'nexus_flow' } });
  process.env['MONGODB_URI'] = mongod.getUri();
  process.env['MONGODB_DB_NAME'] = 'nexus_flow';
  __resetMongoForTests();
  await ensureIndexes(await getMongoDb());
});

after(async () => {
  await closeMongo().catch(() => undefined);
  __resetMongoForTests();
  if (mongod !== null) await mongod.stop().catch(() => undefined);
  mongod = null;
});

describe('match flow: register -> match -> play -> resign -> settle', () => {
  it('pairs two queued players and settles ratings + replay + game doc', async () => {
    const db = await getMongoDb();
    const auth = new AuthService(new MongoUserStore(new UserRepository(db)));
    const alice = await auth.register({ email: 'alice@example.com', username: 'alice', password: 's3cret-pass' });
    const bob = await auth.register({ email: 'bob@example.com', username: 'bobby', password: 's3cret-pass' });

    // Matchmaking pairs them.
    const queue = new MatchmakingQueue(new InMemoryQueueStore());
    const now = Date.now();
    await queue.join({ userId: alice.user.id, mode: 'ranked', timeControl: '3+1', rating: 1500, joinedAt: now });
    await queue.join({ userId: bob.user.id, mode: 'ranked', timeControl: '3+1', rating: 1500, joinedAt: now });
    const pair = await queue.tryMatch(now);
    assert.ok(pair !== null);

    // Game lifecycle through the server-authoritative service.
    const games = new GamesService();
    const g = games.create({
      creatorId: pair.a.userId,
      opponentId: pair.b.userId,
      timeControl: '3+1',
      mode: 'ranked',
      boardSize: 9,
      wallsPerPlayer: 10,
    });
    assert.equal(g.status, 'active');
    const mode = ratingModeFor(g.timeControlId);
    await persistGameCreated(g, mode);

    const first = getLegalMoves(g.state, 0)[0];
    assert.ok(first !== undefined);
    games.play(g.id, pair.a.userId, { type: 'move', to: { r: first.r, c: first.c } });
    await persistMoveAppended(g);
    const wallMove = games.play(g.id, pair.b.userId, { type: 'wall', wall: { r: 0, c: 0, orientation: 'h' } });
    assert.equal(wallMove.actions.length, 2);
    await persistMoveAppended(g);

    const done = games.resign(g.id, pair.a.userId);
    assert.equal(done.status, 'finished');
    assert.equal(done.winnerSeat, 1);
    assert.equal(done.finishReason, 'resign');
    await settleFinishedGame(g);
    await persistGameFinished(g);
    assert.equal(g.settled, true);

    // Settlement evidence in Mongo.
    const ratings = new RatingRepository(db);
    const ra = await ratings.get(pair.a.userId, mode);
    const rb = await ratings.get(pair.b.userId, mode);
    assert.ok(ra !== null && rb !== null);
    assert.equal(ra.games, 1);
    assert.equal(rb.games, 1);
    assert.ok(rb.rating > ra.rating, 'winner gains rating');
    const replay = await new ReplayRepository(db).findByGame(g.id);
    assert.ok(replay !== null);
    assert.equal(replay.actions.length, 2);
    const docs = await new GameRepository(db).listByUser(pair.a.userId, 5);
    assert.equal(docs.length, 1);
    assert.equal(docs[0]?.status, 'FINISHED');
    assert.equal(docs[0]?.result?.winnerSeat, 1);
  });
});
