/**
 * Bot tests: every personality returns legal actions, search is
 * deterministic per seed, evaluation prefers won positions, and a full
 * bot-vs-bot game on 9x9 terminates with a winner.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { applyMove, createGame, validateMove } from '../index.js';
import { evaluateFor } from '../bots/evaluate.js';
import { BOTS, botAction, getBot } from '../bots/personalities.js';
import { makeState } from './helpers.js';

describe('bots: personalities', () => {
  it('defines 10 rated bots with sane budgets', () => {
    assert.equal(BOTS.length, 10);
    for (const b of BOTS) {
      assert.ok(b.id.length > 0);
      assert.ok(b.rating >= 400 && b.rating <= 2600);
      assert.ok(b.wallCandidates >= 0 && b.budgetMs > 0);
    }
    assert.equal(getBot('grandmaster')?.name, 'Grandmaster');
    assert.equal(getBot('nope'), null);
  });

  it('every bot returns a legal action on 9x9 and 15x15 openings', () => {
    for (const size of [9, 15]) {
      for (const b of BOTS) {
        const state = createGame({ size, wallsPerPlayer: size === 9 ? 10 : 20 });
        const action = botAction(b, state, 1234);
        assert.equal(validateMove(state, action).ok, true, `${b.id} size ${size}`);
      }
    }
  });

  it('search is deterministic for the same seed', () => {
    const gm = getBot('architect');
    assert.ok(gm !== null);
    const s1 = createGame({ size: 9, wallsPerPlayer: 10 });
    const a1 = botAction(gm, s1, 777);
    const a2 = botAction(gm, s1, 777);
    assert.deepEqual(a1, a2);
  });

  it('evaluation prefers won positions and shorter paths', () => {
    const open = createGame({ size: 9, wallsPerPlayer: 10 });
    const won = makeState(9, { isOver: true, winner: 0 });
    assert.ok(evaluateFor(won, 0) > evaluateFor(open, 0));
    assert.ok(evaluateFor(won, 0) > evaluateFor(won, 1));
    // Runner up a step: move player 0 one row closer to goal.
    const advanced = makeState(9, { pawns: [{ r: 1, c: 4 }, { r: 8, c: 4 }], turn: 1 });
    assert.ok(evaluateFor(advanced, 0) > evaluateFor(open, 0));
  });

  it('bot-vs-bot 9x9 game terminates with a winner', () => {
    const white = getBot('runner');
    const black = getBot('rookie');
    assert.ok(white !== null && black !== null);
    let state = createGame({ size: 9, wallsPerPlayer: 10 });
    let guard = 0;
    while (!state.isOver && guard < 400) {
      const b = state.turn === 0 ? white : black;
      const action = botAction(b, state, 5000 + guard);
      assert.equal(validateMove(state, action).ok, true);
      state = applyMove(state, action).state;
      guard++;
    }
    assert.equal(state.isOver, true);
    assert.ok(state.winner === 0 || state.winner === 1);
  });
});
