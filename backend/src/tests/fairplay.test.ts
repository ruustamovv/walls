/**
 * Fair-play conduct score (FRP-001): pure scoring, decay, levels, memory
 * store, plus the Mongo repository round-trip. Skill rating untouched.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { MongoMemoryServer } from 'mongodb-memory-server';
import {
  blankConduct,
  applyConductEvent,
  decayConduct,
  conductLevel,
  behaviorGapAllowed,
  MemoryConductStore,
} from '../modules/fairplay/service.js';
import { getMongoDb, closeMongo, __resetMongoForTests } from '../database/mongodb/client.js';
import { FairPlayRepository } from '../database/mongodb/repositories/fairplay.repository.js';

describe('conduct scoring', () => {
  it('starts at 100 with transparent deltas and clamps', () => {
    let r = blankConduct('u');
    assert.equal(r.score, 100);
    r = applyConductEvent(r, 'abandon');
    assert.equal(r.score, 92);
    assert.equal(r.abandons, 1);
    r = applyConductEvent(r, 'verified_abuse');
    assert.equal(r.score, 72);
    r = applyConductEvent(r, 'completed');
    assert.equal(r.score, 73);
    // Floor clamp.
    for (let i = 0; i < 10; i++) r = applyConductEvent(r, 'verified_abuse');
    assert.equal(r.score, 0);
    // Ceiling clamp.
    for (let i = 0; i < 200; i++) r = applyConductEvent(r, 'completed');
    assert.equal(r.score, 100);
  });

  it('decays +1 per idle day toward 100', () => {
    const now = Date.now();
    const low = { ...blankConduct('u', now - 3 * 86_400_000), score: 90, updatedAt: now - 3 * 86_400_000 };
    assert.equal(decayConduct(low, now).score, 93);
    assert.equal(decayConduct(blankConduct('u', now), now).score, 100);
  });

  it('levels are exemplary/good/caution/restricted', () => {
    assert.equal(conductLevel(100), 'exemplary');
    assert.equal(conductLevel(90), 'exemplary');
    assert.equal(conductLevel(89), 'good');
    assert.equal(conductLevel(70), 'good');
    assert.equal(conductLevel(69), 'caution');
    assert.equal(conductLevel(40), 'caution');
    assert.equal(conductLevel(39), 'restricted');
    assert.equal(conductLevel(0), 'restricted');
  });

  it('behavior gap allowance widens with wait, capped at 60', () => {
    assert.equal(behaviorGapAllowed(0), 15);
    assert.equal(behaviorGapAllowed(30_000), 45);
    assert.equal(behaviorGapAllowed(600_000), 60);
  });

  it('memory store mirrors repository semantics', () => {
    const s = new MemoryConductStore();
    assert.equal(s.get('u').score, 100);
    s.record('u', 'abandon');
    assert.equal(s.get('u').score, 92);
    s.record('u', 'verified_abuse');
    assert.equal(s.get('u').score, 72);
  });
});

describe('conduct repository (mongo)', () => {
  let mongod: MongoMemoryServer | null = null;

  before(async () => {
    mongod = await MongoMemoryServer.create({ instance: { dbName: 'nexus_fairplay' } });
    process.env['MONGODB_URI'] = mongod.getUri();
    process.env['MONGODB_DB_NAME'] = 'nexus_fairplay';
    __resetMongoForTests();
  });

  after(async () => {
    await closeMongo().catch(() => undefined);
    __resetMongoForTests();
    if (mongod !== null) await mongod.stop().catch(() => undefined);
    mongod = null;
  });

  it('records events and reads back with decay', async () => {
    const db = await getMongoDb();
    const repo = new FairPlayRepository(db);
    assert.equal((await repo.get('fp_u')).score, 100);
    await repo.record('fp_u', 'abandon');
    await repo.record('fp_u', 'abandon');
    assert.equal((await repo.get('fp_u')).score, 84);
  });
});
