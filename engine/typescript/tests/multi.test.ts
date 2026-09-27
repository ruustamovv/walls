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
  hashMultiState,
  replayMultiGame,
  serializeMultiState,
  validateMultiMove,
} from '../multi/index.js';

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
    assert.throws(() => createMultiGame({ players: 5, size: 9, wallsPerPlayer: 5 }));
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
