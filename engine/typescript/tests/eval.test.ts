/** Multiplayer win-share estimation: sums to 100, leader-first, honest confidence. */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { estimateMultiWinShare } from '../index.js';

describe('eval: multi win share', () => {
  it('splits evenly on a dead-even race with low confidence', () => {
    const r = estimateMultiWinShare([10, 10, 10, 10], [5, 5, 5, 5], 0);
    assert.equal(r.shares.length, 4);
    assert.equal(r.shares.reduce((s, v) => s + v, 0), 100);
    for (const s of r.shares) assert.ok(Math.abs(s - 25) < 6);
    // Turn-order tempo bonus goes to the seat to move.
    assert.ok((r.shares[0] as number) >= (r.shares[1] as number));
    assert.equal(r.confidence, 'low');
  });

  it('favors the leader and sums to 100', () => {
    const r = estimateMultiWinShare([6, 12, 14], [5, 5, 5], 0);
    assert.equal(r.shares.reduce((s, v) => Math.round((s + v) * 10) / 10, 0), 100);
    assert.ok((r.shares[0] as number) > (r.shares[1] as number));
    assert.ok((r.shares[1] as number) > (r.shares[2] as number));
    assert.equal(r.confidence, 'high');
  });

  it('is nearly certain when someone is almost home', () => {
    const r = estimateMultiWinShare([2, 15, 15, 15], [5, 5, 5, 5], 0);
    assert.ok((r.shares[0] as number) > 80);
    assert.equal(r.confidence, 'high');
  });
});
