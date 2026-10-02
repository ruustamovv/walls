/**
 * Puzzle tests: daily generation is deterministic, the reference solution
 * grades as solved, and illegal walls are rejected (not scored).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { curatedDaily, dailyPuzzle, gradeAttempt, seededPuzzlePool, selectPuzzle, DEFAULT_TASTE } from '../puzzles/daily.js';

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

  it('curated daily is deterministic and at least as demanding as classic', () => {
    const a = curatedDaily('2026-09-27');
    const b = curatedDaily('2026-09-27');
    assert.deepEqual(a, b);
    assert.ok(a.difficulty !== undefined);
    assert.ok((a.alternatives ?? 0) >= 1);
    assert.equal(gradeAttempt(a, a.solution).solved, true);
    const classic = dailyPuzzle('2026-09-27');
    assert.ok(a.solutionGain >= classic.solutionGain);
  });

  it('pool selection prefers lonely high-gain answers when sharp', () => {
    const pool = seededPuzzlePool('2026-09-27', 'daily-2026-09-27', '2026-09-27', 6);
    assert.ok(pool.length > 0);
    const sharp = selectPuzzle(pool, { sharp: 1, tense: 0 });
    const mellow = selectPuzzle(pool, { sharp: 0, tense: 0 });
    // Same seed pool yields the same picks (deterministic curation).
    assert.deepEqual(selectPuzzle(pool, DEFAULT_TASTE), selectPuzzle(pool, DEFAULT_TASTE));
    // The sharp taste must pick an answer at least as lonely (unique gap),
    // even when its raw gain is lower — that IS the sharpness criterion.
    const gapOf = (p: typeof sharp): number => {
      const entry = pool.find((e) =>
        e.puzzle.solution.r === p.solution.r &&
        e.puzzle.solution.c === p.solution.c &&
        e.puzzle.solution.orientation === p.solution.orientation);
      assert.ok(entry !== undefined);
      return (entry as { quality: { uniqueGap: number } }).quality.uniqueGap;
    };
    assert.ok(gapOf(sharp) >= gapOf(mellow));
  });
});
