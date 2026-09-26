/** Pawn movement rules: steps, wall blocking, jumps, diagonal jumps. */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyMove,
  createGame,
  getLegalMoves,
  serializeState,
  validateMove,
} from '../index.js';
import { makeState, pos, samePosSet, wall } from './helpers.js';

describe('pawn moves', () => {
  it('basic step: pawn advances, turn switches, input untouched', () => {
    const s0 = createGame({ size: 9, wallsPerPlayer: 10 });
    const legal = getLegalMoves(s0, 0);
    assert.ok(samePosSet(legal, [pos(1, 4), pos(0, 3), pos(0, 5)]));

    const before = serializeState(s0);
    const { state: s1, events } = applyMove(s0, { type: 'move', to: pos(1, 4) });
    assert.deepEqual(s1.pawns[0], pos(1, 4));
    assert.deepEqual(s1.pawns[1], pos(8, 4));
    assert.equal(s1.turn, 1);
    assert.equal(s1.moveNumber, 1);
    assert.deepEqual(events, ['move_made', 'turn_switched']);
    // Purity: input state unchanged.
    assert.equal(serializeState(s0), before);
    assert.deepEqual(s0.pawns[0], pos(0, 4));
  });

  it('illegal move through a wall is rejected', () => {
    // 'h' wall at (0,4) sits between rows 0/1 covering cols 4,5.
    const s = makeState(9, { walls: [wall(0, 4, 'h')] });
    const v = validateMove(s, { type: 'move', to: pos(1, 4) });
    assert.equal(v.ok, false);
    assert.equal(v.reason, 'illegal_move');
    assert.throws(() => applyMove(s, { type: 'move', to: pos(1, 4) }), /illegal_move/);
  });

  it('sideways steps around a wall still work', () => {
    const s = makeState(9, { walls: [wall(0, 4, 'h')] });
    const legal = getLegalMoves(s, 0);
    // Forward blocked, sideways open.
    assert.ok(!legal.some((p) => p.r === 1 && p.c === 4));
    assert.ok(legal.some((p) => p.r === 0 && p.c === 3));
    assert.ok(legal.some((p) => p.r === 0 && p.c === 5));
  });

  it('plain diagonal step is illegal', () => {
    const s = makeState(9);
    const v = validateMove(s, { type: 'move', to: pos(1, 5) });
    assert.equal(v.ok, false);
    assert.equal(v.reason, 'illegal_move');
    assert.throws(() => applyMove(s, { type: 'move', to: pos(1, 5) }), /illegal_move/);
  });

  it('off-board target is out_of_bounds', () => {
    const s = makeState(9);
    const v = validateMove(s, { type: 'move', to: pos(-1, 4) });
    assert.equal(v.ok, false);
    assert.equal(v.reason, 'out_of_bounds');
  });

  it('straight jump over adjacent opponent', () => {
    const s = makeState(9, { pawns: [pos(4, 4), pos(5, 4)], turn: 0 });
    const legal = getLegalMoves(s, 0);
    assert.ok(legal.some((p) => p.r === 6 && p.c === 4), 'straight jump landing (6,4)');
    assert.ok(!legal.some((p) => p.r === 5 && p.c === 4), 'never land on the opponent');
    const s1 = applyMove(s, { type: 'move', to: pos(6, 4) }).state;
    assert.deepEqual(s1.pawns[0], pos(6, 4));
  });

  it('diagonal jump when straight landing is blocked by a wall', () => {
    // P1 at (5,4); 'h' wall at (5,4) blocks (5,4)->(6,4).
    const s = makeState(9, { pawns: [pos(4, 4), pos(5, 4)], turn: 0, walls: [wall(5, 4, 'h')] });
    const legal = getLegalMoves(s, 0);
    assert.ok(!legal.some((p) => p.r === 6 && p.c === 4), 'straight jump blocked');
    assert.ok(legal.some((p) => p.r === 5 && p.c === 3), 'diagonal sidestep left');
    assert.ok(legal.some((p) => p.r === 5 && p.c === 5), 'diagonal sidestep right');
  });

  it('diagonal sidestep limited when one side is also walled', () => {
    const s = makeState(9, {
      pawns: [pos(4, 4), pos(5, 4)],
      turn: 0,
      // Blocks (5,4)->(6,4) and blocks (5,4)->(5,5).
      walls: [wall(5, 4, 'h'), wall(4, 4, 'v')],
    });
    const legal = getLegalMoves(s, 0);
    assert.ok(legal.some((p) => p.r === 5 && p.c === 3));
    assert.ok(!legal.some((p) => p.r === 5 && p.c === 5));
    assert.ok(!legal.some((p) => p.r === 6 && p.c === 4));
  });

  it('diagonal jump at the board edge (beyond is off-board)', () => {
    // P1 cornered on the top row at (0,4), P0 below at (1,4).
    const s = makeState(9, { pawns: [pos(1, 4), pos(0, 4)], turn: 0 });
    const legal = getLegalMoves(s, 0);
    assert.ok(legal.some((p) => p.r === 0 && p.c === 3));
    assert.ok(legal.some((p) => p.r === 0 && p.c === 5));
    assert.ok(!legal.some((p) => p.r === 0 && p.c === 4), 'cannot capture the opponent cell');
  });
});
