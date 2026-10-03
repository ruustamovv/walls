/** Matchmaking: pairing within window, anti-duplicate, window expansion. */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MatchmakingQueue, ratingWindowFor } from '../modules/matchmaking/queue.js';

const base = Date.now();

describe('matchmaking queue', () => {
  it('pairs two close-rated players', async () => {
    const q = new MatchmakingQueue();
    await q.join({ userId: 'a', mode: 'ranked', timeControl: '3+0', rating: 1500, joinedAt: base });
    await q.join({ userId: 'b', mode: 'ranked', timeControl: '3+0', rating: 1540, joinedAt: base });
    const pair = await q.tryMatch(base);
    assert.ok(pair !== null);
    assert.equal(await q.size(), 0);
  });

  it('does not pair far-apart players immediately', async () => {
    const q = new MatchmakingQueue();
    await q.join({ userId: 'a', mode: 'ranked', timeControl: '3+0', rating: 1200, joinedAt: base });
    await q.join({ userId: 'b', mode: 'ranked', timeControl: '3+0', rating: 2000, joinedAt: base });
    const pair = await q.tryMatch(base);
    assert.equal(pair, null);
    assert.equal(await q.size(), 2);
  });

  it('window expands with wait time', () => {
    const w0 = ratingWindowFor(0);
    const wLate = ratingWindowFor(60_000);
    assert.ok(wLate > w0);
  });

  it('player-aware range: newcomers and masters start wider', () => {
    const base0 = ratingWindowFor(0);
    assert.ok(ratingWindowFor(0, 2) > base0);
    assert.ok(ratingWindowFor(0, 30, 2500) > base0);
    assert.equal(ratingWindowFor(0, 30, 1500), base0);
    // Still capped.
    assert.ok(ratingWindowFor(3_600_000, 0, 2600) <= 600);
  });

  it('describe reports position, pool and live window', async () => {
    const q = new MatchmakingQueue();
    await q.join({ userId: 'a', mode: 'ranked', timeControl: '3+0', rating: 1500, gamesPlayed: 40, joinedAt: base });
    await q.join({ userId: 'b', mode: 'ranked', timeControl: '3+0', rating: 1520, gamesPlayed: 3, joinedAt: base + 5 });
    const info = await q.describe('b', base + 10_000);
    assert.ok(info !== null);
    assert.equal(info.position, 2);
    assert.equal(info.poolSize, 2);
    assert.equal(info.waitedMs, 9995);
    assert.ok(info.window >= ratingWindowFor(0));
    assert.equal(await q.describe('ghost'), null);
  });

  it('re-join replaces ticket (anti-duplicate)', async () => {
    const q = new MatchmakingQueue();
    await q.join({ userId: 'a', mode: 'ranked', timeControl: '3+0', rating: 1500, joinedAt: base });
    await q.join({ userId: 'a', mode: 'ranked', timeControl: '3+0', rating: 1600, joinedAt: base + 1 });
    assert.equal(await q.size(), 1);
  });

  it('cancel removes ticket', async () => {
    const q = new MatchmakingQueue();
    await q.join({ userId: 'a', mode: 'ranked', timeControl: '3+0', rating: 1500, joinedAt: base });
    assert.equal(await q.cancel('a'), true);
    assert.equal(await q.size(), 0);
  });
});

describe('matchmaking fairness (MTM-002)', () => {
  it('holds back wide trust gaps until the queue ages', async () => {
    const q = new MatchmakingQueue();
    await q.join({ userId: 'saint', mode: 'ranked', timeControl: '3+0', rating: 1500, joinedAt: base, behavior: 100 });
    await q.join({ userId: 'rough', mode: 'ranked', timeControl: '3+0', rating: 1500, joinedAt: base, behavior: 50 });
    assert.equal(await q.tryMatch(base), null);
    // After forty seconds the gap allowance (15 + 40) covers the 50 gap.
    const pair = await q.tryMatch(base + 40_000);
    assert.ok(pair !== null);
  });

  it('prefers closer trust when ratings tie', async () => {
    const q = new MatchmakingQueue();
    await q.join({ userId: 'head', mode: 'ranked', timeControl: '3+0', rating: 1500, joinedAt: base, behavior: 95 });
    await q.join({ userId: 'near', mode: 'ranked', timeControl: '3+0', rating: 1500, joinedAt: base, behavior: 90 });
    await q.join({ userId: 'far', mode: 'ranked', timeControl: '3+0', rating: 1500, joinedAt: base, behavior: 85 });
    const pair = await q.tryMatch(base);
    assert.ok(pair !== null);
    const ids = [pair.a.userId, pair.b.userId].sort();
    assert.deepEqual(ids, ['head', 'near']);
  });

  it('avoids immediate rematches, then relents after a minute', async () => {
    const q = new MatchmakingQueue();
    await q.join({ userId: 'a', mode: 'ranked', timeControl: '3+0', rating: 1500, joinedAt: base });
    await q.join({ userId: 'b', mode: 'ranked', timeControl: '3+0', rating: 1500, joinedAt: base });
    q.markPaired('a', 'b', base);
    assert.equal(await q.tryMatch(base), null);
    const pair = await q.tryMatch(base + 61_000);
    assert.ok(pair !== null);
  });

  it('prefers same region, then goes cross-region', async () => {
    const q = new MatchmakingQueue();
    await q.join({ userId: 'head', mode: 'ranked', timeControl: '3+0', rating: 1500, joinedAt: base, region: 'Europe/Berlin' });
    await q.join({ userId: 'far', mode: 'ranked', timeControl: '3+0', rating: 1500, joinedAt: base, region: 'America/New_York' });
    await q.join({ userId: 'near', mode: 'ranked', timeControl: '3+0', rating: 1500, joinedAt: base + 1, region: 'Europe/Berlin' });
    const pair = await q.tryMatch(base + 1);
    assert.ok(pair !== null);
    const ids = [pair.a.userId, pair.b.userId].sort();
    assert.deepEqual(ids, ['head', 'near']);
  });

  it('cross-region pairs after 20s when no local partner exists', async () => {
    const q = new MatchmakingQueue();
    await q.join({ userId: 'head', mode: 'ranked', timeControl: '3+0', rating: 1500, joinedAt: base, region: 'Europe/Berlin' });
    await q.join({ userId: 'far', mode: 'ranked', timeControl: '3+0', rating: 1500, joinedAt: base, region: 'America/New_York' });
    assert.equal(await q.tryMatch(base), null);
    const pair = await q.tryMatch(base + 21_000);
    assert.ok(pair !== null);
  });
});
