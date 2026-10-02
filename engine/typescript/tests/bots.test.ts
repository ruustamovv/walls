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
import { adaptiveBudgetMs } from '../bots/search.js';
import { makeState } from './helpers.js';
import { BALANCED_WEIGHTS, topCandidates } from '../index.js';
import { chooseDeepAction } from '../bots/deep.js';

describe('bots: personalities', () => {
  it('defines 19 rated bots covering every target tier', () => {
    assert.equal(BOTS.length, 19);
    for (const b of BOTS) {
      assert.ok(b.id.length > 0);
      assert.ok(b.rating >= 400 && b.rating <= 3300);
      assert.ok(b.wallCandidates >= 0 && b.budgetMs > 0);
      assert.ok(b.depth >= 1 && b.maxNodes > 0);
    }
    for (const tier of [600, 800, 1000, 1200, 1400, 1600, 1800, 2000, 2200, 2400, 2600, 2800, 3000]) {
      assert.ok(BOTS.some((b) => b.rating === tier && b.experimental !== true), `tier ${tier} present`);
    }
    // Only the unproven boss may carry the experimental flag.
    assert.deepEqual(BOTS.filter((b) => b.experimental === true).map((b) => b.id), ['overmind']);
    assert.equal(getBot('grandmaster')?.name, 'Grandmaster');
    assert.equal(getBot('apex')?.rating, 3000);
    assert.equal(getBot('nope'), null);
  });

  it('adaptive budget caps without starving search', () => {
    assert.equal(adaptiveBudgetMs(2500, {}), 2500);
    assert.equal(adaptiveBudgetMs(2500, { hardCapMs: 800 }), 800);
    assert.equal(adaptiveBudgetMs(2500, { clockMsLeft: 5000 }), 200);
    assert.equal(adaptiveBudgetMs(2500, { clockMsLeft: 500 }), 50);
    assert.equal(adaptiveBudgetMs(20, { hardCapMs: 800 }), 20);
    assert.ok(adaptiveBudgetMs(0, {}) >= 1);
  });

  it('wall-reply lever only affects wall-heavy lines', () => {
    const mythic = getBot('mythic');
    const legend = getBot('legend');
    const architect = getBot('architect');
    assert.ok(mythic !== null && legend !== null && architect !== null);
    assert.equal(mythic.replyWalls, true);
    assert.equal(legend.replyWalls, true);
    assert.notEqual(architect.replyWalls, true);
    const s = createGame({ size: 9, wallsPerPlayer: 10 });
    assert.equal(validateMove(s, botAction(mythic, s, 42)).ok, true);
  });

  it('topCandidates returns ordered legal alternatives with route impact', () => {
    const s = createGame({ size: 9, wallsPerPlayer: 10 });
    const opts = { weights: { ...BALANCED_WEIGHTS }, wallCandidates: 24, noise: 0, wallBias: 1, replySearch: false, budgetMs: 150, seed: 7 };
    const cands = topCandidates(s, opts, 3);
    assert.equal(cands.length, 3);
    for (let i = 1; i < cands.length; i++) {
      assert.ok((cands[i - 1] as { score: number }).score >= (cands[i] as { score: number }).score);
    }
    for (const c of cands) {
      assert.equal(validateMove(s, c.action).ok, true);
      assert.ok(Number.isFinite(c.oppGain) && Number.isFinite(c.ownCost));
    }
    const again = topCandidates(s, opts, 3);
    assert.deepEqual(again.map((c) => c.action), cands.map((c) => c.action));
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

  it('deep search is legal, deterministic and expands replies', () => {
    const apex = getBot('apex');
    assert.ok(apex !== null);
    const s = createGame({ size: 9, wallsPerPlayer: 10 });
    const opts = {
      weights: { ...apex.weights },
      depth: 2,
      wallCandidates: 24,
      innerWallCandidates: 8,
      maxNodes: 300,
      wallBias: apex.wallBias,
      noise: 0,
      seed: 99,
    };
    const r1 = chooseDeepAction(s, opts);
    const r2 = chooseDeepAction(s, opts);
    assert.deepEqual(r1.action, r2.action);
    assert.equal(validateMove(s, r1.action).ok, true);
    assert.ok(r1.nodes > 0);
    assert.ok(Number.isFinite(r1.score));
    // Depth 1 degrades to a static search with zero expanded nodes.
    const shallow = chooseDeepAction(s, { ...opts, depth: 1 });
    assert.equal(shallow.nodes, 0);
    assert.equal(validateMove(s, shallow.action).ok, true);
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
