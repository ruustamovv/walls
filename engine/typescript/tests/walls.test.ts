/** Wall placement rules: geometry, inventory, path preservation. */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyMove,
  createGame,
  getLegalWalls,
  validateMove,
  validateWall,
  type Wall,
} from '../index.js';
import { makeState, wall } from './helpers.js';

describe('wall rules', () => {
  it('duplicate wall (overlap) is rejected', () => {
    const s = makeState(9, { walls: [wall(4, 4, 'h')] });
    const v = validateWall(s, 0, wall(4, 4, 'h'));
    assert.equal(v.ok, false);
    assert.equal(v.reason, 'duplicate_wall');
    assert.equal(validateMove(s, { type: 'wall', wall: wall(4, 4, 'h') }).reason, 'duplicate_wall');
  });

  it('crossing wall is rejected', () => {
    const s = makeState(9, { walls: [wall(4, 4, 'h')] });
    const v = validateWall(s, 0, wall(4, 4, 'v'));
    assert.equal(v.ok, false);
    assert.equal(v.reason, 'crossing_wall');
  });

  it('wall outside the board is rejected', () => {
    const s = makeState(9);
    for (const bad of [wall(8, 8, 'h'), wall(-1, 0, 'v'), wall(0, 8, 'h'), wall(7, 8, 'v')]) {
      assert.equal(validateWall(s, 0, bad).reason, 'out_of_bounds', JSON.stringify(bad));
    }
    const bogus = { r: 3, c: 3, orientation: 'x' } as unknown as Wall;
    assert.equal(validateWall(s, 0, bogus).reason, 'invalid_orientation');
  });

  it('wall with no inventory is rejected', () => {
    const s = makeState(9, { wallsRemaining: [0, 10], turn: 0 });
    const v = validateWall(s, 0, wall(2, 2, 'h'));
    assert.equal(v.ok, false);
    assert.equal(v.reason, 'no_walls_remaining');
    assert.deepEqual(getLegalWalls(s, 0), []);
    // Opponent still has stock.
    assert.ok(getLegalWalls(s, 1).length > 0);
  });

  it('wall closing the last route is rejected', () => {
    // Four 'h' walls block rows 4/5 for cols 0..7; col 8 stays open.
    const walls = [wall(4, 0, 'h'), wall(4, 2, 'h'), wall(4, 4, 'h'), wall(4, 6, 'h')];
    const s = makeState(9, { walls, turn: 1, wallsRemaining: [6, 6] });
    // Sanity: gap at col 8 keeps both routes alive.
    assert.equal(validateWall(s, 1, wall(0, 0, 'v')).ok, true);
    // Closing wall covers cols 7,8 -> no route for either pawn.
    const v = validateWall(s, 1, wall(4, 7, 'h'));
    assert.equal(v.ok, false);
    assert.equal(v.reason, 'blocks_path');
    assert.throws(() => applyMove(s, { type: 'wall', wall: wall(4, 7, 'h') }), /blocks_path/);
  });

  it('valid wall with a detour is accepted and consumes inventory', () => {
    const s0 = createGame({ size: 9, wallsPerPlayer: 10 });
    const v = validateMove(s0, { type: 'wall', wall: wall(4, 4, 'h') });
    assert.equal(v.ok, true);
    const { state: s1, events } = applyMove(s0, { type: 'wall', wall: wall(4, 4, 'h') });
    assert.equal(s1.walls.length, 1);
    assert.deepEqual(s1.wallsRemaining, [9, 10]);
    assert.equal(s1.turn, 1);
    assert.equal(s1.moveNumber, 1);
    assert.deepEqual(events, ['wall_placed', 'turn_switched']);
  });

  it('empty 9x9 board offers all 128 geometric slots', () => {
    const s = makeState(9);
    const legal = getLegalWalls(s, 0);
    assert.equal(legal.length, 8 * 8 * 2);
    for (const w of legal) {
      assert.equal(validateWall(s, 0, w).ok, true);
    }
  });

  it('placed walls disappear from legal options (dup + cross)', () => {
    const s = makeState(9, { walls: [wall(2, 2, 'h')] });
    const keys = new Set(getLegalWalls(s, 0).map((w) => `${w.r},${w.c},${w.orientation}`));
    assert.ok(!keys.has('2,2,h'));
    assert.ok(!keys.has('2,2,v'));
  });

  it('no walls legal after game over', () => {
    const s = makeState(9, { isOver: true, winner: 0 });
    assert.equal(validateWall(s, 0, wall(1, 1, 'h')).reason, 'game_over');
    assert.deepEqual(getLegalWalls(s, 0), []);
  });
});
