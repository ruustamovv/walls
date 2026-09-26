/** Game lifecycle: config, winning, hashing, serialization, replays, BFS metrics. */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyMove,
  BOARD_PRESETS,
  buildReplay,
  createGame,
  deserializeState,
  findShortestPath,
  getLegalMoves,
  getPathMetrics,
  hasPathToGoal,
  hashState,
  isGameOver,
  replayGame,
  RULES_VERSION,
  serializeState,
  validateMove,
  verifyReplay,
  type Action,
} from '../index.js';
import { makeState, pos, wall } from './helpers.js';

describe('game lifecycle', () => {
  it('createGame honours presets and pawn placement', () => {
    assert.deepEqual(BOARD_PRESETS.classic, { size: 9, wallsPerPlayer: 10 });
    assert.deepEqual(BOARD_PRESETS.standard, { size: 15, wallsPerPlayer: 20 });
    assert.deepEqual(BOARD_PRESETS.siege, { size: 17, wallsPerPlayer: 30 });

    const g = createGame({ size: 9, wallsPerPlayer: 10 });
    assert.deepEqual(g.pawns[0], pos(0, 4)); // P0 top, heads down
    assert.deepEqual(g.pawns[1], pos(8, 4)); // P1 bottom, heads up
    assert.equal(g.turn, 0);
    assert.equal(g.isOver, false);
    assert.equal(g.winner, null);
    assert.equal(g.moveNumber, 0);
    assert.equal(g.lastAction, null);
    assert.equal(g.rulesVersion, RULES_VERSION);
    assert.deepEqual(g.wallsRemaining, [10, 10]);
  });

  it('any size >= 5 works, including even sizes', () => {
    const g = createGame({ size: 6, wallsPerPlayer: 3 });
    assert.deepEqual(g.pawns[0], pos(0, 3));
    assert.deepEqual(g.pawns[1], pos(5, 3));
    assert.throws(() => createGame({ size: 4, wallsPerPlayer: 10 }), /Invalid board size/);
    assert.throws(() => createGame({ size: 9, wallsPerPlayer: -1 }), /Invalid wall count/);
  });

  it('P0 wins on reaching the bottom row', () => {
    const s = makeState(9, { pawns: [pos(7, 4), pos(8, 0)], turn: 0 });
    const { state: s1, events } = applyMove(s, { type: 'move', to: pos(8, 4) });
    assert.equal(isGameOver(s1), true);
    assert.equal(s1.winner, 0);
    assert.deepEqual(events, ['move_made', 'game_won']);
    assert.equal(s1.turn, 0); // no turn switch after a win
    assert.equal(validateMove(s1, { type: 'move', to: pos(7, 4) }).reason, 'game_over');
    assert.throws(() => applyMove(s1, { type: 'move', to: pos(7, 4) }), /game_over/);
  });

  it('P1 wins on reaching the top row', () => {
    const s = makeState(9, { pawns: [pos(0, 0), pos(1, 2)], turn: 1 });
    const s1 = applyMove(s, { type: 'move', to: pos(0, 2) }).state;
    assert.equal(s1.winner, 1);
    assert.equal(s1.isOver, true);
  });

  it('empty-board shortest paths and metrics are symmetric', () => {
    const s = makeState(9);
    assert.equal(findShortestPath(s, 0).length, 8);
    assert.equal(findShortestPath(s, 1).length, 8);
    const m = getPathMetrics(s);
    assert.deepEqual(m, {
      pathLengthA: 8,
      pathLengthB: 8,
      delta: 0,
      reachableA: true,
      reachableB: true,
    });
    const p = findShortestPath(s, 0);
    assert.deepEqual(p.path[0], pos(0, 4));
    assert.equal(p.path[p.path.length - 1]?.r, 8);
    assert.equal(p.path.length, 9);
  });

  it('boxed-in pawn is unreachable', () => {
    // P0 at (0,4): down blocked by h(0,3); left by v(0,3); right by v(0,4).
    const s = makeState(9, {
      walls: [wall(0, 3, 'h'), wall(0, 3, 'v'), wall(0, 4, 'v')],
    });
    assert.equal(findShortestPath(s, 0).length, -1);
    assert.deepEqual(findShortestPath(s, 0).path, []);
    assert.equal(hasPathToGoal(s, 0), false);
    assert.equal(hasPathToGoal(s, 1), true);
    const m = getPathMetrics(s);
    assert.equal(m.reachableA, false);
    assert.equal(m.reachableB, true);
  });

  it('walls lengthen routes (detour accepted, metrics shift)', () => {
    const s = makeState(9, { walls: [wall(0, 3, 'h'), wall(0, 5, 'h')] });
    // Columns 3..6 blocked between rows 0/1; P0 must sidestep.
    assert.ok(findShortestPath(s, 0).length > 8);
    assert.equal(hasPathToGoal(s, 0), true);
  });

  it('serialization round-trips and preserves the hash', () => {
    let s = createGame({ size: 9, wallsPerPlayer: 10 });
    s = applyMove(s, { type: 'move', to: pos(1, 4) }).state;
    s = applyMove(s, { type: 'wall', wall: wall(4, 4, 'h') }).state;
    const json = serializeState(s);
    const back = deserializeState(json);
    assert.deepEqual(back, s);
    assert.equal(hashState(back), hashState(s));
    assert.throws(() => deserializeState('not json'), /Malformed/);
    assert.throws(() => deserializeState('{"size":3}'), /Malformed/);
  });

  it('hashing is deterministic and sensitive', () => {
    const a = makeState(9);
    const b = makeState(9);
    assert.equal(hashState(a), hashState(b));
    assert.match(hashState(a), /^[0-9a-f]{8}$/);
    const moved = applyMove(a, { type: 'move', to: pos(1, 4) }).state;
    assert.notEqual(hashState(moved), hashState(a));
  });

  it('replayGame matches sequential application; verifyReplay accepts', () => {
    const config = { size: 9, wallsPerPlayer: 10 };
    const actions: Action[] = [
      { type: 'move', to: pos(1, 4) },
      { type: 'move', to: pos(7, 4) },
      { type: 'wall', wall: wall(4, 4, 'h') },
      { type: 'move', to: pos(6, 4) },
    ];
    let ref = createGame(config);
    for (const a of actions) ref = applyMove(ref, a).state;

    const { state, events } = replayGame(config, actions);
    assert.deepEqual(state, ref);
    assert.ok(events.length > 0);

    const replay = buildReplay(config, actions);
    assert.equal(replay.hashes.length, actions.length);
    assert.equal(replay.finalHash, hashState(ref));
    assert.deepEqual(verifyReplay(replay), { ok: true });

    // Tampered action diverges at index 2.
    const tampered = buildReplay(config, actions);
    tampered.actions[2] = { type: 'wall', wall: wall(0, 0, 'v') };
    const bad = verifyReplay(tampered);
    assert.equal(bad.ok, false);
    assert.equal(bad.failedAt, 2);

    // Tampered hash is detected even with valid actions.
    const forged = buildReplay(config, actions);
    forged.hashes[0] = 'deadbeef';
    assert.equal(verifyReplay(forged).ok, false);
  });

  it('getLegalMoves defaults to the side to move', () => {
    const s = makeState(9, { turn: 1 });
    assert.deepEqual(getLegalMoves(s), getLegalMoves(s, 1));
  });

  it('seed is recorded when provided', () => {
    const s = createGame({ size: 9, wallsPerPlayer: 10 }, 42);
    assert.equal(s.seed, 42);
    const back = deserializeState(serializeState(s));
    assert.equal(back.seed, 42);
  });
});
