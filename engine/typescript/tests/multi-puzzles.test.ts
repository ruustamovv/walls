/** Multiplayer choke puzzles: deterministic generation + grading. */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { seededMultiPuzzle, gradeMultiAttempt, multiPuzzleDaily } from '../index.js';

describe('multi puzzles', () => {
  it('generates the same puzzle for the same seed', () => {
    const a = seededMultiPuzzle('2026-09-30:4p', 't1', '2026-09-30', 4);
    const b = seededMultiPuzzle('2026-09-30:4p', 't1', '2026-09-30', 4);
    assert.deepEqual(a, b);
    assert.equal(a.players, 4);
    assert.ok(a.solutionGain >= a.needGain);
  });

  it('grades the reference solution as solved and weak walls as not', () => {
    const p = seededMultiPuzzle('2026-09-30:4p', 't1', '2026-09-30', 4);
    const good = gradeMultiAttempt(p, p.solution);
    assert.equal(good.legal, true);
    assert.equal(good.solved, true);
    assert.ok(good.gain >= p.needGain);
    // A far-corner wall gains nothing on the leader.
    const weak = gradeMultiAttempt(p, { r: p.size - 2, c: 0, orientation: 'h' });
    if (weak.legal) assert.equal(weak.solved, false);
  });

  it('daily multi puzzle is date-deterministic', () => {
    const a = multiPuzzleDaily('2026-09-30', 4);
    const b = multiPuzzleDaily('2026-09-30', 4);
    assert.deepEqual(a.solution, b.solution);
    assert.equal(a.puzzleId, 'multi-daily-2026-09-30-4p');
  });
});
