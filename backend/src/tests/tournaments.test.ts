/**
 * Tournaments: pure pairing math + full single-elim + round-robin flows
 * against in-process Mongo.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { pairSingleElim, pairSwiss, roundRobinSchedule } from '../modules/tournaments/pairing.js';
import {
  arenaPlay, createTournament, finishTournament, joinTournament, openTournament, reportResult, startTournament, standings, tournamentDetail,
} from '../modules/tournaments/service.js';
import { AuthService } from '../modules/auth/service.js';
import { MongoUserStore } from '../modules/auth/store.js';
import { UserRepository } from '../database/mongodb/repositories/user.repository.js';
import { ensureIndexes } from '../database/mongodb/indexes.js';
import { getMongoDb, closeMongo, __resetMongoForTests } from '../database/mongodb/client.js';

let mongod: MongoMemoryServer | null = null;

before(async () => {
  mongod = await MongoMemoryServer.create({ instance: { dbName: 'nexus_tour' } });
  process.env['MONGODB_URI'] = mongod.getUri();
  process.env['MONGODB_DB_NAME'] = 'nexus_tour';
  __resetMongoForTests();
  await ensureIndexes(await getMongoDb());
});

after(async () => {
  await closeMongo().catch(() => undefined);
  const { closeRedis, __resetRedisForTests } = await import('../database/redis/client.js');
  await closeRedis().catch(() => undefined);
  __resetMongoForTests();
  __resetRedisForTests();
  if (mongod !== null) await mongod.stop().catch(() => undefined);
  mongod = null;
});

async function makeUsers(n: number): Promise<string[]> {
  const db = await getMongoDb();
  const auth = new AuthService(new MongoUserStore(new UserRepository(db)));
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const r = await auth.register({ email: `t${Date.now()}_${i}@e.com`, username: `tour_${Date.now().toString(36)}_${i}`, password: 's3cret-pass' });
    ids.push(r.user.id);
  }
  return ids;
}

describe('tournaments: pairing math', () => {
  it('seeds single-elim top-vs-bottom with middle bye', () => {
    assert.deepEqual(pairSingleElim(['a', 'b', 'c', 'd']), [['a', 'd'], ['b', 'c']]);
    assert.deepEqual(pairSingleElim(['a', 'b', 'c']), [['b', null], ['a', 'c']]);
  });

  it('round-robins every pairing exactly once', () => {
    const schedule = roundRobinSchedule(['a', 'b', 'c', 'd']);
    assert.equal(schedule.length, 3);
    const seen = new Set<string>();
    for (const round of schedule) {
      assert.equal(round.length, 2);
      for (const [a, b] of round) {
        if (a === null || b === null) continue;
        const k = [a, b].sort().join('|');
        assert.ok(!seen.has(k), `duplicate ${k}`);
        seen.add(k);
      }
    }
    assert.equal(seen.size, 6);
  });

  it('swiss pairs by points and avoids rematches', () => {
    const { pairs, bye } = pairSwiss(
      [{ userId: 'a', points: 2 }, { userId: 'b', points: 2 }, { userId: 'c', points: 1 }, { userId: 'd', points: 0 }, { userId: 'e', points: 0 }],
      new Set(['a|b']),
    );
    assert.equal(bye, 'e');
    assert.deepEqual(pairs, [['a', 'c'], ['b', 'd']]);
  });
});

describe('tournaments: single-elim flow', () => {
  it('create -> join -> open -> start -> report -> champion', async () => {
    const [o, p2, p3, p4] = await makeUsers(4);
    const t = await createTournament(o as string, { title: 'Cup', format: 'single-elim' });
    assert.equal(t.status, 'DRAFT');
    for (const p of [p2, p3, p4] as string[]) await joinTournament(t._id, p);
    await openTournament(t._id);
    await startTournament(t._id);

    let detail = await tournamentDetail(t._id);
    assert.equal(detail?.tournament.status, 'LIVE');
    assert.equal(detail?.rounds.length, 1);
    assert.equal(detail?.rounds[0]?.matches.length, 2);

    // Report both semifinals: winners are the paired players.
    const semi = detail?.rounds[0]?.matches ?? [];
    await reportResult(t._id, 1, 0, (semi[0]?.a ?? '') as string, o as string);
    await reportResult(t._id, 1, 1, (semi[1]?.a ?? '') as string, o as string);

    detail = await tournamentDetail(t._id);
    assert.equal(detail?.rounds.length, 2); // final auto-generated
    const fin = detail?.rounds[1]?.matches ?? [];
    assert.equal(fin.length, 1);
    await reportResult(t._id, 2, 0, (fin[0]?.a ?? '') as string, o as string);

    detail = await tournamentDetail(t._id);
    assert.equal(detail?.tournament.status, 'FINISHED');
    assert.equal(detail?.tournament.champion, fin[0]?.a);
    const table = await standings(t._id);
    assert.equal(table[0]?.userId, fin[0]?.a);
    assert.equal(table[0]?.wins, 2);
  });
});

describe('tournaments: arena flow', () => {
  it('queues, pairs, scores and crowns', async () => {
    const [o, p2, p3] = await makeUsers(3);
    const t = await createTournament(o as string, { title: 'Friday Arena', format: 'arena', durationMinutes: 60 });
    assert.equal(t.status, 'DRAFT');
    for (const p of [p2, p3] as string[]) await joinTournament(t._id, p);
    await startTournament(t._id);

    const w1 = await arenaPlay(t._id, p2 as string);
    assert.equal(w1.status, 'waiting');
    // p3 arrives while p2 waits: instant pairing into a live game.
    const m = await arenaPlay(t._id, p3 as string);
    assert.equal(m.status, 'matched');
    if (m.status !== 'matched') throw new Error('unreachable');
    assert.ok(m.gameId.length > 0);

    // The pairing is filed as round 1; reporting works through it.
    const detail = await tournamentDetail(t._id);
    assert.equal(detail?.rounds.length, 1);
    await reportResult(t._id, 1, 0, p2 as string, o as string);
    const table = await standings(t._id);
    assert.equal(table[0]?.userId, p2);
    assert.equal(table[0]?.points, 1);

    await finishTournament(t._id, o as string);
    const done = await tournamentDetail(t._id);
    assert.equal(done?.tournament.status, 'FINISHED');
    assert.equal(done?.tournament.champion, p2);
  });

  it('rejects non-arena queueing and non-owner finish', async () => {
    const [o, p2] = await makeUsers(2);
    const t = await createTournament(o as string, { title: 'Cup', format: 'single-elim' });
    await joinTournament(t._id, p2 as string);
    await startTournament(t._id);
    await assert.rejects(() => arenaPlay(t._id, p2 as string));
    await assert.rejects(() => finishTournament(t._id, p2 as string));
  });
});

describe('tournaments: round-robin flow', () => {
  it('plays every pairing and crowns the points leader', async () => {
    const [o, p2, p3] = await makeUsers(3);
    const t = await createTournament(o as string, { title: 'League', format: 'round-robin' });
    for (const p of [p2, p3] as string[]) await joinTournament(t._id, p);
    await startTournament(t._id); // DRAFT starts directly too

    const detail = await tournamentDetail(t._id);
    assert.equal(detail?.rounds.length, 3); // 3 players -> 3 rounds, one bye each
    // a beats everyone it meets.
    for (const rd of detail?.rounds ?? []) {
      for (let i = 0; i < rd.matches.length; i++) {
        const m = rd.matches[i];
        if (m === undefined || m.b === null || m.winner !== null) continue;
        await reportResult(t._id, rd.round, i, (m.a === o ? m.a : m.b) as string, o as string);
      }
    }
    const done = await tournamentDetail(t._id);
    assert.equal(done?.tournament.status, 'FINISHED');
    assert.equal(done?.tournament.champion, o);
  });
});

describe('tournaments: recurrence', () => {
  it('daily series spawns its next edition on sweep', async () => {
    const { sweepRecurrence } = await import('../modules/tournaments/service.js');
    const { TournamentRepository } = await import('../database/mongodb/repositories/extended.repositories.js');
    const { getMongoDb } = await import('../database/mongodb/client.js');
    const [o, p2] = await makeUsers(2);
    const t = await createTournament(o as string, { title: 'Daily Cup', format: 'single-elim', recurrence: 'daily' });
    await joinTournament(t._id, p2 as string);
    await openTournament(t._id);
    await startTournament(t._id);
    let detail = await tournamentDetail(t._id);
    const fin = detail?.rounds[0]?.matches ?? [];
    assert.equal(fin.length, 1);
    await reportResult(t._id, 1, 0, (fin[0]?.a ?? '') as string, o as string);
    detail = await tournamentDetail(t._id);
    assert.equal(detail?.tournament.status, 'FINISHED');

    // Fast-forward past the next run and sweep twice (idempotent-ish).
    const db = await getMongoDb();
    const { COLLECTIONS } = await import('../database/mongodb/collections.js');
    const { tryToObjectId } = await import('../database/mongodb/ids.js');
    const oid = tryToObjectId(t._id);
    assert.ok(oid !== null);
    await db.collection(COLLECTIONS.tournaments).updateOne({ _id: oid }, { $set: { nextRunAt: new Date(Date.now() - 1000) } });
    const spawned = await sweepRecurrence(Date.now());
    assert.equal(spawned.length, 1);
    const repo = new TournamentRepository(db);
    const next = await repo.findById(spawned[0] as string);
    assert.ok(next !== null);
    assert.equal(next.status, 'DRAFT');
    assert.equal(next.recurrence, 'daily');
    assert.match(next.title, /Daily Cup #2/);
    // Second sweep finds nothing due (advance-first).
    assert.deepEqual(await sweepRecurrence(Date.now()), []);
  });
});
