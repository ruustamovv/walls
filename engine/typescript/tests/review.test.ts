/**
 * Review tests: labels fire on engineered positions, review is
 * deterministic, and a calm draw-ish line scores near 100.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { applyMove, createGame } from '../index.js';
import { reviewGame } from '../review/analyze.js';
import { botAction, getBot } from '../bots/personalities.js';

describe('review: labels', () => {
  it('flags a wasted wall as WALL_BLUNDER', () => {
    // Far-corner wall: zero route impact for either pawn.
    const review = reviewGame({ size: 9, wallsPerPlayer: 10 }, [
      { type: 'wall', wall: { r: 7, c: 0, orientation: 'h' } },
    ]);
    assert.ok(review.moves[0]?.labels.includes('WALL_BLUNDER'));
  });

  it('is deterministic across runs', () => {
    const actions = [
      { type: 'move', to: { r: 1, c: 4 } },
      { type: 'move', to: { r: 7, c: 4 } },
      { type: 'wall', wall: { r: 1, c: 3, orientation: 'h' } },
    ] as const;
    const a = reviewGame({ size: 9, wallsPerPlayer: 10 }, actions.map((x) => ({ ...x })));
    const b = reviewGame({ size: 9, wallsPerPlayer: 10 }, actions.map((x) => ({ ...x })));
    assert.deepEqual(a, b);
  });

  it('classifies moves, scores accuracy and tracks the eval curve', () => {
    const actions = [
      { type: 'move', to: { r: 1, c: 4 } },
      { type: 'move', to: { r: 7, c: 4 } },
      { type: 'move', to: { r: 2, c: 4 } },
      { type: 'move', to: { r: 6, c: 4 } },
    ] as const;
    const review = reviewGame({ size: 9, wallsPerPlayer: 10 }, actions.map((x) => ({ ...x })));
    assert.equal(review.moves.length, 4);
    assert.equal(review.evalCurve.length, 4);
    for (const m of review.moves) {
      assert.ok(['BRILLIANT', 'GREAT', 'BEST', 'EXCELLENT', 'GOOD', 'BOOK', 'INACCURACY', 'MISTAKE', 'MISS', 'BLUNDER'].includes(m.class));
    }
    // Clean forward marches are near-perfect.
    assert.ok(review.summary.accuracy[0] >= 80);
    assert.ok(review.summary.accuracy[1] >= 80);
    const total = review.summary.classCounts[0].BEST + review.summary.classCounts[0].GOOD
      + review.summary.classCounts[0].EXCELLENT + review.summary.classCounts[0].BRILLIANT;
    assert.ok(total >= 1);
  });

  it('parses best-action strings back into actions', async () => {
    const { parseBestAction } = await import('../review/analyze.js');
    assert.deepEqual(parseBestAction('move 3,4'), { type: 'move', to: { r: 3, c: 4 } });
    assert.deepEqual(parseBestAction('wall h 2,2'), { type: 'wall', wall: { orientation: 'h', r: 2, c: 2 } });
    assert.equal(parseBestAction('nonsense'), null);
  });

  it('reviews a real bot game end to end', () => {
    const white = getBot('runner');
    const black = getBot('rookie');
    assert.ok(white !== null && black !== null);
    let state = createGame({ size: 9, wallsPerPlayer: 10 });
    const actions: import('../core/types.js').Action[] = [];
    let guard = 0;
    while (!state.isOver && guard < 300) {
      const action = botAction(state.turn === 0 ? white : black, state, 9000 + guard);
      actions.push(action);
      state = applyMove(state, action).state;
      guard++;
    }
    assert.equal(state.isOver, true);
    const review = reviewGame({ size: 9, wallsPerPlayer: 10 }, actions);
    assert.equal(review.moves.length, actions.length);
    const last = review.moves[review.moves.length - 1];
    assert.ok(last?.labels.includes('CLUTCH'));
    assert.ok(review.summary.score[0] >= 5 && review.summary.score[0] <= 100);
  });
});
