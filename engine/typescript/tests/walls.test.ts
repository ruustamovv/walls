/** Wall placement rules: geometry, inventory, path preservation. */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyMove,
  createGame,
  describeAction,
  getLegalWalls,
  isBlockedBetween,
  parseBestAction,
  replayGame,
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
    // Corner pocket with exactly one exit: h(0,0) blocks the downward steps
    // under columns 0-1, v(0,2) blocks the step (0,2)->(0,3). Pawn 1 is forced
    // down column 2 and still reaches its goal side (row 0) via column 2.
    const s = makeState(9, {
      pawns: [{ r: 0, c: 0 }, { r: 8, c: 8 }],
      walls: [wall(0, 0, 'h'), wall(0, 2, 'v')],
      turn: 0,
      wallsRemaining: [6, 6],
    });
    // Sanity: a route exists and a harmless wall far away is accepted.
    assert.equal(validateWall(s, 0, wall(6, 6, 'v')).ok, true);
    // Closing wall cuts (0,1)->(0,2) and strands pawn 1 in the corner.
    const v = validateWall(s, 0, wall(0, 1, 'v'));
    assert.equal(v.ok, false);
    assert.equal(v.reason, 'blocks_path');
    assert.throws(() => applyMove(s, { type: 'wall', wall: wall(0, 1, 'v') }), /blocks_path/);
  });

  it('a full-width barrier can never be completed by stacking sticks', () => {
    // Four 2-cell pieces tile columns 0-7; column 8 can only be covered by a
    // piece at c=7, which would overlap its neighbour. That is correct
    // Quoridor geometry — you cannot seal a row band by doubling up.
    const s0 = createGame({ size: 9, wallsPerPlayer: 10 });
    let s = s0;
    for (const c of [0, 2, 4, 6]) {
      s = applyMove(s, { type: 'wall', wall: wall(4, c, 'h') }).state;
    }
    assert.equal(validateWall(s, 0, wall(4, 7, 'h')).reason, 'overlapping_wall');
    // And no path was sealed by the four-piece barrier.
    assert.equal(validateWall(s, 0, wall(6, 3, 'v')).ok, true);
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

describe('wall geometry is canonically two cells', () => {
  it('horizontal wall blocks exactly its two covered columns', () => {
    const walls = [wall(4, 4, 'h')];
    // Covered: vertical steps in columns 4 and 5 across rows 4/5.
    assert.equal(isBlockedBetween({ r: 4, c: 4 }, { r: 5, c: 4 }, walls), true);
    assert.equal(isBlockedBetween({ r: 4, c: 5 }, { r: 5, c: 5 }, walls), true);
    assert.equal(isBlockedBetween({ r: 5, c: 4 }, { r: 4, c: 4 }, walls), true);
    // Neighbors outside the span stay open: no half-cell bleed.
    assert.equal(isBlockedBetween({ r: 4, c: 3 }, { r: 5, c: 3 }, walls), false);
    assert.equal(isBlockedBetween({ r: 4, c: 6 }, { r: 5, c: 6 }, walls), false);
    // Horizontal steps on those rows are unaffected.
    assert.equal(isBlockedBetween({ r: 4, c: 4 }, { r: 4, c: 5 }, walls), false);
  });

  it('vertical wall blocks exactly its two covered rows', () => {
    const walls = [wall(4, 4, 'v')];
    assert.equal(isBlockedBetween({ r: 4, c: 4 }, { r: 4, c: 5 }, walls), true);
    assert.equal(isBlockedBetween({ r: 5, c: 4 }, { r: 5, c: 5 }, walls), true);
    assert.equal(isBlockedBetween({ r: 3, c: 4 }, { r: 3, c: 5 }, walls), false);
    assert.equal(isBlockedBetween({ r: 6, c: 4 }, { r: 6, c: 5 }, walls), false);
    assert.equal(isBlockedBetween({ r: 4, c: 4 }, { r: 5, c: 4 }, walls), false);
  });

  it('collinear neighbours two apart form a clean 4-cell barrier', () => {
    // A piece is two cells long, so the next collinear slot is 2 away.
    const s0 = createGame({ size: 9, wallsPerPlayer: 10 });
    assert.equal(validateWall(s0, 0, wall(4, 2, 'h')).ok, true);
    assert.equal(validateWall(s0, 0, wall(4, 4, 'h')).ok, true, 'end-to-end neighbour is legal');
    const s1 = applyMove(s0, { type: 'wall', wall: wall(4, 2, 'h') }).state;
    const s2 = applyMove(s1, { type: 'wall', wall: wall(4, 4, 'h') }).state;
    assert.equal(s2.walls.length, 2);
    assert.deepEqual(s2.wallsRemaining, [9, 9], 'two pieces, two walls consumed');
    // Together they block four distinct columns.
    for (const c of [2, 3, 4, 5]) {
      assert.equal(isBlockedBetween({ r: 4, c }, { r: 5, c }, s2.walls), true, `column ${c} blocked`);
    }
    assert.equal(isBlockedBetween({ r: 4, c: 6 }, { r: 5, c: 6 }, s2.walls), false, 'no bleed past the ends');
    assert.equal(isBlockedBetween({ r: 4, c: 1 }, { r: 5, c: 1 }, s2.walls), false);
  });

  it('collinear half-overlap is rejected: a stick never sits on top of another', () => {
    const s0 = createGame({ size: 9, wallsPerPlayer: 10 });
    // h(4,4) covers columns 4-5, so h(4,5) would overlap it by one cell.
    const s1 = applyMove(s0, { type: 'wall', wall: wall(4, 4, 'h') }).state;
    assert.equal(validateWall(s1, 0, wall(4, 5, 'h')).reason, 'overlapping_wall');
    assert.equal(validateWall(s1, 0, wall(4, 3, 'h')).reason, 'overlapping_wall');
    assert.equal(validateWall(s1, 0, wall(4, 6, 'h')).ok, true, 'two away is still fine');

    // Same rule vertically.
    const v0 = createGame({ size: 9, wallsPerPlayer: 10 });
    const v1 = applyMove(v0, { type: 'wall', wall: wall(4, 4, 'v') }).state;
    assert.equal(validateWall(v1, 0, wall(5, 4, 'v')).reason, 'overlapping_wall');
    assert.equal(validateWall(v1, 0, wall(3, 4, 'v')).reason, 'overlapping_wall');
    assert.equal(validateWall(v1, 0, wall(6, 4, 'v')).ok, true);
  });

  it('T-junction and L-junction placements are legal (touching, not overlapping)', () => {
    // T: vertical stem meets the corner where two horizontals join.
    const t = makeState(9, { walls: [wall(4, 3, 'h'), wall(4, 4, 'h')] });
    assert.equal(validateWall(t, 0, wall(3, 4, 'v')).ok, true);
    // L: vertical wall meets a horizontal barrier end at its corner.
    const l = makeState(9, { walls: [wall(4, 4, 'h'), wall(4, 5, 'h')] });
    assert.equal(validateWall(l, 0, wall(4, 6, 'v')).ok, true);
  });

  it('fractional coordinates are rejected as out of bounds', () => {
    const s = makeState(9);
    for (const bad of [
      { r: 2.5, c: 2, orientation: 'h' },
      { r: 2, c: 2.5, orientation: 'v' },
      { r: NaN, c: 2, orientation: 'h' },
    ] as unknown as Wall[]) {
      assert.equal(validateWall(s, 0, bad).reason, 'out_of_bounds', JSON.stringify(bad));
    }
  });

  it('each wall placement consumes exactly one wall, never zero or two', () => {
    const s0 = createGame({ size: 9, wallsPerPlayer: 3 });
    const s1 = applyMove(s0, { type: 'wall', wall: wall(1, 1, 'h') }).state;
    assert.deepEqual(s1.wallsRemaining, [2, 3]);
    const s2 = applyMove(s1, { type: 'wall', wall: wall(6, 6, 'h') }).state;
    assert.deepEqual(s2.wallsRemaining, [2, 2]);
  });

  it('wall actions serialize and replay deterministically', () => {
    assert.equal(describeAction({ type: 'wall', wall: wall(2, 2, 'h') }), 'wall h 2,2');
    assert.deepEqual(parseBestAction('wall h 2,2'), { type: 'wall', wall: { orientation: 'h', r: 2, c: 2 } });
    assert.deepEqual(parseBestAction('move 3,4'), { type: 'move', to: { r: 3, c: 4 } });
    assert.equal(parseBestAction('wall x 2,2'), null);
    const actions = [
      { type: 'move', to: { r: 1, c: 4 } },
      { type: 'wall', wall: wall(2, 2, 'h') },
      { type: 'move', to: { r: 2, c: 4 } },
    ] as const;
    const live = actions.reduce((s, a) => applyMove(s, { ...a }).state, createGame({ size: 9, wallsPerPlayer: 10 }));
    const replayed = replayGame({ size: 9, wallsPerPlayer: 10 }, actions.map((a) => ({ ...a })));
    assert.equal(replayed.state.walls.length, 1);
    assert.deepEqual(replayed.state.wallsRemaining, live.wallsRemaining);
    assert.deepEqual(replayed.state.pawns, live.pawns);
  });
});

describe('walls: ownership stamp', () => {
  it('applyMove stamps the mover seat; serialize/parse round-trips it', async () => {
    const { applyMove: apply, createGame: create, serializeState, deserializeState } = await import('../index.js');
    let s = create({ size: 9, wallsPerPlayer: 10 });
    s = apply(s, { type: 'wall', wall: { r: 2, c: 2, orientation: 'h' } }).state;
    assert.equal(s.walls[0]?.by, 0);
    s = apply(s, { type: 'wall', wall: { r: 4, c: 4, orientation: 'v' } }).state;
    assert.equal(s.walls[1]?.by, 1);
    const restored = deserializeState(serializeState(s));
    assert.equal(restored.walls[0]?.by, 0);
    assert.equal(restored.walls[1]?.by, 1);
  });
});
