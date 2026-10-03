/**
 * Time controls: every advertised id resolves to clocks, validates in all
 * schemas, and lands in the documented rating bucket.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { TIME_CONTROLS } from '../config/app.js';
import { CreateGameSchema, MatchmakingJoinSchema } from '../common/validation/schemas.js';
import { ratingModeFor } from '../modules/games/finish.js';

const KNOWN = ['1+0', '1+1', '2+1', '3+0', '3+1', '3+2', '5+0', '5+1', '10+0', '10+5', '15+10'];

describe('time controls', () => {
  it('every known id has sane clocks', () => {
    for (const id of KNOWN) {
      const tc = TIME_CONTROLS.find((t) => t.id === id);
      assert.ok(tc !== undefined, `missing ${id}`);
      assert.ok(tc.baseSec > 0 && tc.incSec >= 0);
    }
  });

  it('every known id validates in game + matchmaking schemas', () => {
    for (const id of KNOWN) {
      assert.ok(CreateGameSchema.safeParse({ timeControl: id }).success, `create rejects ${id}`);
      assert.ok(MatchmakingJoinSchema.safeParse({ mode: 'casual', timeControl: id }).success, `mm rejects ${id}`);
    }
  });

  it('rating buckets match the documented ladder', () => {
    assert.equal(ratingModeFor('1+0'), 'bullet');
    assert.equal(ratingModeFor('2+1'), 'bullet');
    assert.equal(ratingModeFor('3+2'), 'blitz');
    assert.equal(ratingModeFor('5+1'), 'rapid');
    assert.equal(ratingModeFor('10+5'), 'classic');
    assert.equal(ratingModeFor('15+10'), 'classic');
  });
});
