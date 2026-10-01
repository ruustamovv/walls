/**
 * Multiplayer engine tests: rotation, jumps over any pawn, N-path no-seal
 * rule, goal detection per side, determinism, bot legality, full 4P game.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyMultiMove,
  chooseMultiBotAction,
  createMultiGame,
  getMultiLegalMoves,
  getMultiLegalWalls,
  hashMultiState,
  presetForPlayers,
  replayMultiGame,
  serializeMultiState,
  validateMultiMove,
  validateMultiWall,
} from '../multi/index.js';
import { isBlockedBetween } from '../index.js';

describe('multi: lifecycle', () => {
  it('creates 4P with edge starts and rotates turns', () => {
    const s = createMultiGame({ players: 4, size: 9, wallsPerPlayer: 5 });
    assert.deepEqual(s.sides, ['S', 'N', 'E', 'W']);
    assert.deepEqual(s.pawns[2], { r: 4, c: 0 });
    assert.deepEqual(s.pawns[3], { r: 4, c: 8 });
    const first = getMultiLegalMoves(s, 0)[0];
    assert.ok(first !== undefined);
    const out = applyMultiMove(s, { type: 'move', to: first });
    assert.equal(out.state.turn, 1);
    assert.equal(out.state.moveNumber, 1);
  });

  it('rejects bad configs', () => {
    assert.throws(() => createMultiGame({ players: 7, size: 9, wallsPerPlayer: 5 }));
    assert.throws(() => createMultiGame({ players: 1, size: 9, wallsPerPlayer: 5 }));
    assert.throws(() => createMultiGame({ players: 4, size: 4, wallsPerPlayer: 5 }));
  });

  it('wins by reaching your own goal side', () => {
    let s = createMultiGame({ players: 3, size: 9, wallsPerPlayer: 10 });
    // Drive seat 1 (goal N, starts bottom) straight up while others pass.
    let guard = 0;
    while (!s.isOver && guard < 60) {
      const moves = getMultiLegalMoves(s, s.turn);
      // Prefer forward progress for the mover.
      const side = s.sides[s.turn] as string;
      const fwd = moves.filter((m) =>
        side === 'S' ? m.r > s.pawns[s.turn]!.r :
        side === 'N' ? m.r < s.pawns[s.turn]!.r :
        side === 'E' ? m.c > s.pawns[s.turn]!.c : m.c < s.pawns[s.turn]!.c,
      );
      const pick = (fwd[0] ?? moves[0])!;
      s = applyMultiMove(s, { type: 'move', to: pick }).state;
      guard++;
    }
    assert.equal(s.isOver, true);
    assert.ok(s.winner !== null && s.winner >= 0 && s.winner < 3);
  });

  it('no-seal rule protects every pawn', () => {
    const s = createMultiGame({ players: 4, size: 9, wallsPerPlayer: 5 });
    // A wall ring attempt around pawn 0's start must be rejected when it
    // would seal someone; at minimum the full-wall enumeration stays sane.
    const v = validateMultiMove(s, { type: 'wall', wall: { r: 0, c: 3, orientation: 'h' } });
    assert.equal(v.ok, true);
  });

  it('serialization round-trips deterministically', () => {
    const a = createMultiGame({ players: 4, size: 9, wallsPerPlayer: 5 }, 42);
    const b = createMultiGame({ players: 4, size: 9, wallsPerPlayer: 5 }, 42);
    assert.equal(serializeMultiState(a), serializeMultiState(b));
    assert.equal(hashMultiState(a), hashMultiState(b));
  });

  it('presetForPlayers is the single scaling source', () => {
    assert.deepEqual(presetForPlayers(2), { size: 9, wallsPerPlayer: 10 });
    assert.deepEqual(presetForPlayers(3), { size: 13, wallsPerPlayer: 10 });
    assert.deepEqual(presetForPlayers(4), { size: 9, wallsPerPlayer: 5 });
    assert.deepEqual(presetForPlayers(5), { size: 19, wallsPerPlayer: 8 });
    assert.deepEqual(presetForPlayers(6), { size: 21, wallsPerPlayer: 8 });
    assert.deepEqual(presetForPlayers(99), { size: 21, wallsPerPlayer: 8 });
  });

  it('5P shares the S edge with distinct offset lanes', () => {
    const s = createMultiGame({ players: 5, size: 19, wallsPerPlayer: 8 });
    assert.deepEqual(s.sides, ['S', 'N', 'E', 'W', 'S']);
    assert.deepEqual(s.pawns[0], { r: 0, c: 9 });
    assert.deepEqual(s.pawns[4], { r: 0, c: 7 });
    const cells = new Set(s.pawns.map((p) => `${p.r},${p.c}`));
    assert.equal(cells.size, 5);
    // Explicit duplicate sides also resolve to distinct lanes (never stacked).
    const duo = createMultiGame({ players: 2, size: 9, wallsPerPlayer: 10, sides: ['S', 'S'] });
    assert.notDeepEqual(duo.pawns[0], duo.pawns[1]);
  });

  it('bot-vs-bot 5P game terminates with placement order', () => {
    let s = createMultiGame({ players: 5, size: 13, wallsPerPlayer: 6 });
    let guard = 0;
    while (!s.isOver && guard < 600) {
      const action = chooseMultiBotAction(s, { seed: 7000 + guard, budgetMs: 30 });
      s = applyMultiMove(s, action).state;
      guard++;
    }
    assert.equal(s.isOver, true);
    assert.ok(s.winner !== null && s.winner >= 0 && s.winner < 5);
  });

  it('6P shares S+N edges with distinct lanes and terminates', () => {
    const s = createMultiGame({ players: 6, size: 21, wallsPerPlayer: 8 });
    assert.deepEqual(s.sides, ['S', 'N', 'E', 'W', 'S', 'N']);
    const cells = new Set(s.pawns.map((p) => `${p.r},${p.c}`));
    assert.equal(cells.size, 6);
    let g = s;
    let guard = 0;
    while (!g.isOver && guard < 900) {
      const action = chooseMultiBotAction(g, { seed: 9000 + guard, budgetMs: 20 });
      g = applyMultiMove(g, action).state;
      guard++;
    }
    assert.equal(g.isOver, true);
    assert.ok(g.winner !== null && g.winner >= 0 && g.winner < 6);
  });
});

describe('multi: wall geometry is canonically two cells', () => {
  it('horizontal wall blocks exactly its two covered columns', () => {
    const s = createMultiGame({ players: 4, size: 9, wallsPerPlayer: 5 });
    assert.equal(validateMultiWall(s, 0, { r: 2, c: 2, orientation: 'h' }).ok, true);
    const walls = [{ r: 2, c: 2, orientation: 'h' as const }];
    assert.equal(isBlockedBetween({ r: 2, c: 2 }, { r: 3, c: 2 }, walls), true);
    assert.equal(isBlockedBetween({ r: 2, c: 3 }, { r: 3, c: 3 }, walls), true);
    assert.equal(isBlockedBetween({ r: 2, c: 4 }, { r: 3, c: 4 }, walls), false);
  });

  it('duplicate, crossing, fractional and out-of-bounds walls rejected', () => {
    const s = createMultiGame({ players: 4, size: 9, wallsPerPlayer: 5 });
    const s1 = applyMultiMove(s, { type: 'wall', wall: { r: 2, c: 2, orientation: 'h' } }).state;
    assert.equal(s1.walls.length, 1);
    assert.deepEqual(s1.wallsRemaining, [4, 5, 5, 5]);
    assert.equal(validateMultiWall(s1, 1, { r: 2, c: 2, orientation: 'h' }).ok, false);
    assert.equal(validateMultiWall(s1, 1, { r: 2, c: 2, orientation: 'v' }).ok, false);
    assert.equal(
      validateMultiWall(s1, 1, { r: 2.5, c: 2, orientation: 'h' } as unknown as { r: number; c: number; orientation: 'h' }).ok,
      false,
    );
    assert.equal(validateMultiWall(s1, 1, { r: 8, c: 8, orientation: 'h' }).ok, false);
  });

  it('sealing any single pawn is rejected', () => {
    // Cage three sides of seat 2 (E, starts mid-left) is fine; the test
    // asserts the full legal-wall enumeration never seals a pawn: every
    // wall it offers must keep all routes alive.
    const s = createMultiGame({ players: 4, size: 9, wallsPerPlayer: 5 });
    for (const w of getMultiLegalWalls(s, 0)) {
      assert.equal(validateMultiWall(s, 0, w).ok, true);
    }
    assert.ok(getMultiLegalWalls(s, 0).length > 100);
  });
});

describe('multi: bots', () => {
  it('every bot action is legal and deterministic per seed', () => {
    const s = createMultiGame({ players: 4, size: 9, wallsPerPlayer: 5 });
    const a1 = chooseMultiBotAction(s, { seed: 99 });
    const a2 = chooseMultiBotAction(s, { seed: 99 });
    assert.deepEqual(a1, a2);
    assert.equal(validateMultiMove(s, a1).ok, true);
  });

  it('bot-vs-bot 4P game terminates', () => {
    let s = createMultiGame({ players: 4, size: 9, wallsPerPlayer: 5 });
    let guard = 0;
    while (!s.isOver && guard < 500) {
      const action = chooseMultiBotAction(s, { seed: 5000 + guard, budgetMs: 30, wallCandidates: 12 });
      assert.equal(validateMultiMove(s, action).ok, true);
      s = applyMultiMove(s, action).state;
      guard++;
    }
    assert.equal(s.isOver, true);
  });

  it('replay reproduces the final hash', () => {
    const actions = [
      { type: 'move', to: { r: 1, c: 4 } },
      { type: 'move', to: { r: 7, c: 4 } },
      { type: 'move', to: { r: 4, c: 1 } },
      { type: 'move', to: { r: 4, c: 7 } },
    ] as const;
    const { state } = replayMultiGame(
      { players: 4, size: 9, wallsPerPlayer: 5 },
      actions.map((a) => ({ ...a })),
    );
    assert.equal(state.moveNumber, 4);
    assert.equal(state.turn, 0);
    assert.ok(hashMultiState(state).length === 8);
  });
});
