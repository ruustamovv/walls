/** Glicko-2 sanity: provisional flag, win-gain / loss-drop, inactivity widening. */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { defaultRating, isProvisional, updateRatings } from '../modules/ratings/glicko2.js';

describe('glicko2', () => {
  it('defaults are 1500/350/0.06 and provisional', () => {
    const r = defaultRating();
    assert.equal(r.rating, 1500);
    assert.equal(r.rd, 350);
    assert.equal(r.vol, 0.06);
    assert.equal(isProvisional(r), true);
  });

  it('beating a stronger opponent raises rating and tightens RD', () => {
    const me = defaultRating();
    const next = updateRatings(me, [{ rating: 1700, rd: 100, score: 1 }]);
    assert.ok(next.rating > me.rating, `expected gain, got ${next.rating}`);
    assert.ok(next.rd < me.rd, `expected tighter RD, got ${next.rd}`);
  });

  it('losing to a weaker opponent drops rating', () => {
    const me = defaultRating();
    const next = updateRatings(me, [{ rating: 1300, rd: 100, score: 0 }]);
    assert.ok(next.rating < me.rating, `expected drop, got ${next.rating}`);
  });

  it('inactivity widens RD without moving rating', () => {
    const me = { rating: 1600, rd: 100, vol: 0.06 };
    const next = updateRatings(me, []);
    assert.equal(next.rating, 1600);
    assert.ok(next.rd > me.rd);
  });
});
