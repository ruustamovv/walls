/**
 * Puzzle tests: daily generation is deterministic, the reference solution
 * grades as solved, and illegal walls are rejected (not scored).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { dailyPuzzle, gradeAttempt } from '../puzzles/daily.js';

describe('puzzles: daily', () => {
  it('generates the same puzzle for the same date', () => {
    const a = dailyPuzzle('2026-09-27');
    const b = dailyPuzzle('2026-09-27');
    assert.deepEqual(a, b);
    assert.ok(a.solution !== undefined);
    assert.equal(a.needGain, 3);
    assert.ok(a.solutionGain >= 3);
  });

  it('grades the reference solution as solved', () => {
    const puzzle = dailyPuzzle('2026-09-27');
    const verdict = gradeAttempt(puzzle, puzzle.solution);
    assert.equal(verdict.legal, true);
    assert.equal(verdict.solved, true);
    assert.ok(verdict.gain >= puzzle.needGain);
  });

  it('rejects an out-of-bounds wall without scoring it', () => {
    const puzzle = dailyPuzzle('2026-09-27');
    const verdict = gradeAttempt(puzzle, { r: 8, c: 8, orientation: 'h' });
    assert.equal(verdict.legal, false);
    assert.equal(verdict.solved, false);
  });
});
