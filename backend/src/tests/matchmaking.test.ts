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
