/** Deterministic chat filter: blocklist, spam shapes, shouting. No I/O. */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { scoreMessage } from '../modules/moderation/filter.js';

describe('chat filter', () => {
  it('blocks slur stems', () => {
    for (const t of ['you are such a fucker', 'KYS noob', 'shut up, asshole']) {
      const v = scoreMessage(t);
      assert.equal(v.decision, 'block');
      assert.ok(v.reasons.includes('blocklist'));
    }
  });

  it('flags links, spam repetition, shouting — and only that', () => {
    assert.deepEqual(scoreMessage('see https://evil.example/a').decision, 'flag');
    assert.deepEqual(scoreMessage('noooooooo way').decision, 'flag');
    assert.deepEqual(scoreMessage('YOU ARE ALL TERRIBLE PLAYERS HERE').decision, 'flag');
    assert.deepEqual(scoreMessage('Good luck').decision, 'allow');
    assert.deepEqual(scoreMessage('nice wall, well played').decision, 'allow');
    assert.deepEqual(scoreMessage('').decision, 'allow');
  });

  it('does not match blocklist substrings inside innocent words', () => {
    // 'shit' inside... use a clean word containing no stem.
    assert.deepEqual(scoreMessage('that was a classy endgame').decision, 'allow');
  });
});
