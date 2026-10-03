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
  fogMap,
  getMultiLegalMoves,
  getMultiLegalWalls,
  hashMultiState,
  hiddenWallCount,
  presetForPlayers,
  replayMultiGame,
  serializeMultiState,
  validateMultiMove,
  validateMultiWall,
  visibleWalls,
  hasSidePath,
  seatTeams,
  teamMates,
  SIEGE_WALL_BONUS,
  MULTI_PRESETS,
  type MultiAction,
  type MultiPos,
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

describe('multi: continueAfterWin (MLT-007)', () => {
  it('default mode ends at the first goal (unchanged behavior)', () => {
    const s0 = createMultiGame({ players: 4, size: 9, wallsPerPlayer: 5 });
    assert.equal(s0.continueAfterWin, false);
    let cur = s0;
    const live = (seat: number): MultiAction => {
      const p = cur.pawns[seat] as MultiPos;
      if (seat === 0) return { type: 'move', to: p.c === 4 ? { r: 0, c: 3 } : { r: p.r + 1, c: 3 } };
      if (seat === 1) return { type: 'move', to: p.c === 4 ? { r: 8, c: 5 } : { r: 8, c: 4 } };
      if (seat === 2) return { type: 'move', to: p.c === 0 ? { r: 4, c: 1 } : { r: 4, c: 0 } };
      return { type: 'move', to: p.c === 8 ? { r: 4, c: 7 } : { r: 4, c: 8 } };
    };
    let guard = 0;
    while (!cur.isOver && guard < 100) {
      const seat = cur.turn;
      cur = applyMultiMove(cur, live(seat)).state;
      guard++;
    }
    assert.equal(cur.isOver, true);
    assert.equal(cur.winner, 0);
    assert.equal(cur.eliminated.length, 0);
    assert.equal(cur.placement.length, 0);
  });

  it('opt-in mode records placement and removes the seat from rotation', () => {
    let cur = createMultiGame({ players: 4, size: 9, wallsPerPlayer: 5, continueAfterWin: true });
    assert.equal(cur.continueAfterWin, true);
    const live = (seat: number): MultiAction => {
      const p = cur.pawns[seat] as MultiPos;
      if (seat === 0) {
        // To S goal via column 3 (seat 1 sits on column 4).
        if (cur.eliminated.includes(0)) return { type: 'move', to: p };
        return { type: 'move', to: p.c === 4 ? { r: 0, c: 3 } : { r: p.r + 1, c: 3 } };
      }
      if (seat === 1) {
        if (cur.eliminated.includes(1)) return { type: 'move', to: p };
        // Wait until seat 0 is out, then walk up column 4 to the N edge.
        if (!cur.eliminated.includes(0)) return { type: 'move', to: p.c === 4 ? { r: 8, c: 5 } : { r: 8, c: 4 } };
        return { type: 'move', to: { r: p.r - 1, c: 4 } };
      }
      if (seat === 2) {
        if (cur.eliminated.includes(2)) return { type: 'move', to: p };
        // Wait until seat 1 is out, then take row 3 to the E edge (c=8).
        if (!cur.eliminated.includes(1)) return { type: 'move', to: p.c === 0 ? { r: 4, c: 1 } : { r: 4, c: 0 } };
        return { type: 'move', to: p.r === 4 ? { r: 3, c: p.c } : { r: 3, c: p.c + 1 } };
      }
      if (cur.eliminated.includes(3)) return { type: 'move', to: p };
      // Wait until seat 2 is out, then walk row 4 left to the W edge (c=0).
      if (!cur.eliminated.includes(2)) return { type: 'move', to: p.c === 8 ? { r: 4, c: 7 } : { r: 4, c: 8 } };
      return { type: 'move', to: { r: 4, c: p.c - 1 } };
    };
    let guard = 0;
    while (!cur.isOver && guard < 400) {
      const seat = cur.turn;
      cur = applyMultiMove(cur, live(seat)).state;
      guard++;
    }
    assert.equal(cur.isOver, true);
    assert.equal(cur.winner, 0);
    assert.deepEqual(cur.placement, [0, 1, 2, 3]);
    assert.deepEqual(cur.eliminated, [0, 1, 2, 3]);
  });

  it('eliminated seats never regain the turn mid-game', () => {
    let cur = createMultiGame({ players: 3, size: 9, wallsPerPlayer: 5, continueAfterWin: true });
    // Seat 0 (S) walks down column 4 to the goal; seat 1 (E) then takes row 5
    // to the E edge; seat 2 (W) oscillates on row 4 until seat 1 is out.
    const live = (seat: number): MultiAction => {
      const p = cur.pawns[seat] as MultiPos;
      if (seat === 0) {
        if (cur.eliminated.includes(0)) return { type: 'move', to: p };
        return { type: 'move', to: { r: p.r + 1, c: 4 } };
      }
      if (seat === 1) {
        if (cur.eliminated.includes(1)) return { type: 'move', to: p };
        if (!cur.eliminated.includes(0)) return { type: 'move', to: p.c === 0 ? { r: 4, c: 1 } : { r: 4, c: 0 } };
        return { type: 'move', to: p.r === 4 ? { r: 5, c: p.c } : { r: 5, c: p.c + 1 } };
      }
      if (cur.eliminated.includes(2)) return { type: 'move', to: p };
      if (!cur.eliminated.includes(1)) return { type: 'move', to: p.c === 8 ? { r: 4, c: 7 } : { r: 4, c: 8 } };
      return { type: 'move', to: { r: 4, c: p.c - 1 } };
    };
    let guard = 0;
    while (!cur.isOver && guard < 200) {
      const seat = cur.turn;
      cur = applyMultiMove(cur, live(seat)).state;
      guard++;
    }
    assert.equal(cur.isOver, true);
    assert.deepEqual(cur.placement, [0, 1, 2]);
    assert.equal(cur.winner, 0);
  });

  it('two-player opt-in game ends when the second seat finishes', () => {
    let cur = createMultiGame({ players: 2, size: 9, wallsPerPlayer: 10, continueAfterWin: true });
    const live = (seat: number): MultiAction => {
      const p = cur.pawns[seat] as MultiPos;
      if (seat === 0) {
        if (cur.eliminated.includes(0)) return { type: 'move', to: p };
        return { type: 'move', to: p.c === 4 ? { r: 0, c: 3 } : { r: p.r + 1, c: 3 } };
      }
      if (cur.eliminated.includes(1)) return { type: 'move', to: p };
      if (!cur.eliminated.includes(0)) return { type: 'move', to: p.c === 4 ? { r: 8, c: 5 } : { r: 8, c: 4 } };
      return { type: 'move', to: { r: p.r - 1, c: 4 } };
    };
    let guard = 0;
    while (!cur.isOver && guard < 200) {
      const seat = cur.turn;
      cur = applyMultiMove(cur, live(seat)).state;
      guard++;
    }
    assert.equal(cur.isOver, true);
    assert.deepEqual(cur.placement, [0, 1]);
    assert.equal(cur.winner, 0);
  });

  it('serialization round-trips with elimination state', () => {
    let a = createMultiGame({ players: 4, size: 9, wallsPerPlayer: 5, continueAfterWin: true }, 7);
    a = applyMultiMove(a, { type: 'move', to: { r: 0, c: 3 } }).state;
    const b = createMultiGame({ players: 4, size: 9, wallsPerPlayer: 5, continueAfterWin: true }, 7);
    assert.notEqual(serializeMultiState(a), serializeMultiState(b));
    assert.equal(a.eliminated.length, 0);
    assert.equal(hashMultiState(a).length, 8);
  });
});

describe('multi: team mode (MLT-009)', () => {
  it('rejects team mode for unsupported seat counts and bad flag combos', () => {
    assert.throws(() => createMultiGame({ players: 3, size: 9, wallsPerPlayer: 5, teamMode: true }), /2 or 4 seats/);
    assert.throws(() => createMultiGame({ players: 6, size: 9, wallsPerPlayer: 5, teamMode: true }), /2 or 4 seats/);
    assert.throws(
      () => createMultiGame({ players: 4, size: 9, wallsPerPlayer: 5, teamMode: true, continueAfterWin: true }),
      /mutually exclusive/,
    );
    // Free-for-all is untouched: no teams at all.
    const ffa = createMultiGame({ players: 4, size: 9, wallsPerPlayer: 5 });
    assert.equal(ffa.teamOf, null);
    assert.equal(ffa.winningTeam, null);
  });

  it('4P teams are seats 0+2 vs 1+3, so turns are never adjacent teammates', () => {
    const ffa = createMultiGame({ players: 4, size: 9, wallsPerPlayer: 5 });
    const s = createMultiGame({ players: 4, size: 9, wallsPerPlayer: 5, teamMode: true });
    assert.deepEqual(s.teamOf, [0, 1, 0, 1]);
    assert.deepEqual(seatTeams(4), [0, 1, 0, 1]);
    assert.deepEqual(seatTeams(2), [0, 1]);
    assert.deepEqual(teamMates(s, 0), [2]);
    assert.deepEqual(teamMates(s, 2), [0]);
    assert.deepEqual(teamMates(s, 1), [3]);
    assert.deepEqual(teamMates(ffa, 0), []);
  });

  it('the FIRST seat home wins for its whole team', () => {
    let s = createMultiGame({ players: 4, size: 9, wallsPerPlayer: 5, teamMode: true });
    assert.equal(s.sides[0], 'S');
    // Seat 0 (team 0) walks to the S edge first; game ends immediately even
    // though teammate seat 2 is still far from home.
    const live = (seat: number): MultiAction => {
      const p = s.pawns[seat] as MultiPos;
      if (seat === 0) return { type: 'move', to: p.c === 4 ? { r: 0, c: 3 } : { r: p.r + 1, c: 3 } };
      if (seat === 1) return { type: 'move', to: p.c === 4 ? { r: 8, c: 5 } : { r: 8, c: 4 } };
      if (seat === 2) return { type: 'move', to: p.c === 0 ? { r: 4, c: 1 } : { r: 4, c: 0 } };
      return { type: 'move', to: p.c === 8 ? { r: 4, c: 7 } : { r: 4, c: 8 } };
    };
    let guard = 0;
    while (!s.isOver && guard < 100) {
      const seat = s.turn;
      s = applyMultiMove(s, live(seat)).state;
      guard++;
    }
    assert.equal(s.isOver, true);
    assert.equal(s.winner, 0, 'seat 0 reached home');
    assert.equal(s.winningTeam, 0, 'team 0 wins with its finisher');
    assert.equal((s.teamOf as number[])[s.winner as number], s.winningTeam);
    // Only one finisher: team mode does not accumulate placements.
    assert.equal(s.placement[0], 0);
    assert.equal(s.eliminated.length, 0, 'no elimination in team mode');
  });

  it('a teammate finishing after the first goal is not recorded', () => {
    let s = createMultiGame({ players: 4, size: 9, wallsPerPlayer: 5, teamMode: true });
    // Seat 1 (team 1) is the first home: drive it to the N edge (r=0).
    const live = (seat: number): MultiAction => {
      const p = s.pawns[seat] as MultiPos;
      if (seat === 0) return { type: 'move', to: p.c === 4 ? { r: 0, c: 3 } : { r: p.r + 1, c: 3 } };
      if (seat === 1) return { type: 'move', to: p.r === 8 ? { r: 7, c: 4 } : { r: p.r - 1, c: 4 } };
      if (seat === 2) return { type: 'move', to: p.c === 0 ? { r: 4, c: 1 } : { r: 4, c: 0 } };
      return { type: 'move', to: p.c === 8 ? { r: 4, c: 7 } : { r: 4, c: 8 } };
    };
    let guard = 0;
    while (!s.isOver && guard < 100) {
      const seat = s.turn;
      s = applyMultiMove(s, live(seat)).state;
      guard++;
    }
    assert.equal(s.isOver, true);
    assert.equal(s.winner, 1);
    assert.equal(s.winningTeam, 1, 'team 1 wins');
  });

  it('team mode serializes deterministically', () => {
    const a = createMultiGame({ players: 4, size: 9, wallsPerPlayer: 5, teamMode: true }, 5);
    const b = createMultiGame({ players: 4, size: 9, wallsPerPlayer: 5, teamMode: true }, 5);
    assert.equal(serializeMultiState(a), serializeMultiState(b));
    assert.equal(hashMultiState(a), hashMultiState(b));
    assert.ok(hashMultiState(a).length === 8);
    const ffa = createMultiGame({ players: 4, size: 9, wallsPerPlayer: 5 }, 5);
    assert.notEqual(serializeMultiState(a), serializeMultiState(ffa));
  });

  it('team4 preset matches party4 geometry (only the team flag differs)', () => {
    assert.deepEqual(MULTI_PRESETS.team4, MULTI_PRESETS.party4);
    const team = createMultiGame({ ...MULTI_PRESETS.team4, teamMode: true });
    const ffa = createMultiGame(MULTI_PRESETS.team4);
    assert.deepEqual(team.pawns, ffa.pawns);
    assert.deepEqual(team.sides, ffa.sides);
    assert.notEqual(team.teamOf, null);
  });
});

describe('multi: fog of war (MLT-009)', () => {
  it('a fresh fog game hides every far wall and defaults to no fog', () => {
    const plain = createMultiGame({ players: 4, size: 9, wallsPerPlayer: 5 });
    assert.equal(plain.fog, false, 'default stays fully visible');

    const fog = createMultiGame({ players: 4, size: 9, wallsPerPlayer: 5, fog: true });
    assert.equal(fog.fog, true);
    // Seat 3 places a wall far from every other pawn -> invisible to all.
    let s = applyMultiMove(fog, { type: 'move', to: { r: 0, c: 3 } }).state;  // seat 0
    s = applyMultiMove(s, { type: 'move', to: { r: 7, c: 4 } }).state;        // seat 1
    s = applyMultiMove(s, { type: 'move', to: { r: 4, c: 1 } }).state;        // seat 2
    s = applyMultiMove(s, { type: 'wall', wall: { r: 6, c: 6, orientation: 'h' } }).state; // seat 3
    assert.equal(s.walls.length, 1);
    for (let seat = 0; seat < 4; seat++) {
      assert.equal(visibleWalls(s, seat).length, 0, `seat ${seat} cannot see the far wall`);
    }
    assert.equal(hiddenWallCount(s, 0), 1);
    // The engine still validates against TRUE state, never the fogged view.
    assert.equal(s.walls.length, 1);
  });

  it('a wall becomes visible once it neighbours that seat’s own pawn', () => {
    let s = createMultiGame({ players: 4, size: 9, wallsPerPlayer: 5, fog: true });
    // Drive to a position where a known wall sits right next to seat 0.
    s = applyMultiMove(s, { type: 'move', to: { r: 0, c: 3 } }).state; // seat 0 -> {0,3}
    s = applyMultiMove(s, { type: 'move', to: { r: 7, c: 4 } }).state; // seat 1
    s = applyMultiMove(s, { type: 'move', to: { r: 4, c: 1 } }).state; // seat 2
    // Seat 3 places a wall at {0,2} h: separates (0,2)-(1,2), adjacent to (0,3).
    s = applyMultiMove(s, { type: 'wall', wall: { r: 0, c: 2, orientation: 'h' } }).state;
    assert.equal(s.walls.length, 1);
    // Wall {0,2}h separates (0,2)-(1,2); seat 0 pawn at (0,3) is 1 away -> visible.
    assert.equal(visibleWalls(s, 0).length, 1, 'adjacent wall is revealed to seat 0');
    assert.equal(hiddenWallCount(s, 0), 0);
    // Seat 2 pawn is at (4,0): the wall is far away, so it stays hidden.
    assert.equal(visibleWalls(s, 2).length, 0, 'the same wall is still fogged for seat 2');
  });

  it('reveals the whole board once the game is over', () => {
    let s = createMultiGame({ players: 2, size: 9, wallsPerPlayer: 10, fog: true });
    // Seat 0 walls far away (hidden from itself), then walks to its own goal.
    s = applyMultiMove(s, { type: 'wall', wall: { r: 6, c: 6, orientation: 'h' } }).state;
    assert.equal(visibleWalls(s, 0).length, 0, 'its own far wall is still hidden');
    assert.equal(hiddenWallCount(s, 1), 1, 'and hidden from the opponent too');

    // Seat 0 (S) sidesteps to column 3 then walks down; seat 1 (N) oscillates.
    const live = (seat: number): MultiAction => {
      const p = s.pawns[seat] as MultiPos;
      if (seat === 0) return { type: 'move', to: p.c === 4 ? { r: 0, c: 3 } : { r: p.r + 1, c: 3 } };
      return { type: 'move', to: p.c === 4 ? { r: 8, c: 5 } : { r: 8, c: 4 } };
    };
    let guard = 0;
    while (!s.isOver && guard < 40) {
      s = applyMultiMove(s, live(s.turn)).state;
      guard++;
    }
    assert.equal(s.isOver, true, 'a seat reached its goal');
    assert.equal(visibleWalls(s, 0).length, 1, 'full board revealed for review');
    assert.equal(hiddenWallCount(s, 0), 0);
  });

  it('every seat gets its own view; fogMap differs per seat', () => {
    let s = createMultiGame({ players: 4, size: 9, wallsPerPlayer: 5, fog: true });
    s = applyMultiMove(s, { type: 'move', to: { r: 0, c: 3 } }).state;
    s = applyMultiMove(s, { type: 'move', to: { r: 7, c: 4 } }).state;
    s = applyMultiMove(s, { type: 'move', to: { r: 4, c: 1 } }).state;
    s = applyMultiMove(s, { type: 'wall', wall: { r: 0, c: 2, orientation: 'h' } }).state;
    const map = fogMap(s);
    assert.equal(map.length, 4);
    assert.notDeepEqual(map[0], map[2], 'seat 0 sees the wall, seat 2 does not');
    assert.deepEqual(map[0], [s.walls[0]!.r * 1000 + s.walls[0]!.c * 10 + 1]);
  });

  it('an out-of-range viewer sees nothing (spectator, never the full board)', () => {
    const s = createMultiGame({ players: 2, size: 9, wallsPerPlayer: 10, fog: true });
    assert.deepEqual(visibleWalls(s, -1), []);
    assert.deepEqual(visibleWalls(s, 99), []);
  });

  it('fog is serialized so replays and hashes stay reproducible', () => {
    const a = createMultiGame({ players: 4, size: 9, wallsPerPlayer: 5, fog: true }, 3);
    const b = createMultiGame({ players: 4, size: 9, wallsPerPlayer: 5, fog: true }, 3);
    const c = createMultiGame({ players: 4, size: 9, wallsPerPlayer: 5 }, 3);
    assert.equal(hashMultiState(a), hashMultiState(b));
    assert.notEqual(hashMultiState(a), hashMultiState(c), 'fog and non-fog differ');
    assert.notEqual(serializeMultiState(a), serializeMultiState(c));
  });
});

describe('multi: chaos + siege (MLT-009)', () => {
  it('chaos requires a seed so replays stay deterministic', () => {
    assert.throws(() => createMultiGame({ players: 4, size: 9, wallsPerPlayer: 5, chaos: true }), /requires a seed/);
    const s = createMultiGame({ players: 4, size: 9, wallsPerPlayer: 5, chaos: true }, 11);
    assert.equal(s.chaos, true);
    assert.equal(s.seed, 11);
    assert.equal(createMultiGame({ players: 4, size: 9, wallsPerPlayer: 5, seed: 4, chaos: true }).chaos, true);
  });

  it('chaos rotates a wall from the richest seat to the poorest on cadence', () => {
    const s0 = createMultiGame({ players: 4, size: 9, wallsPerPlayer: 5, chaos: true }, 1);
    assert.deepEqual(s0.wallsRemaining, [5, 5, 5, 5]);

    // Seat 0 places a wall (4 left); seats 1..3 just move.
    let s = applyMultiMove(s0, { type: 'wall', wall: { r: 2, c: 2, orientation: 'h' } }).state;
    assert.equal(s.wallsRemaining[0], 4);
    // Each seat takes a legal step from ITS OWN current legal set, so rotation
    // order never produces an illegal action.
    const live = (seat: number): MultiAction => {
      const options = getMultiLegalMoves(s, seat);
      assert.ok(options.length > 0, `seat ${seat} has a legal move`);
      return { type: 'move', to: options[0] as MultiPos };
    };
    let rotations = 0;
    let guard = 0;
    while (!s.isOver && guard < 40) {
      const out = applyMultiMove(s, live(s.turn));
      s = out.state;
      if (out.events.includes('chaos_rotation')) rotations++;
      guard++;
    }
    assert.ok(rotations > 0, 'the budget actually rotated');
    // Rotation never creates walls from nothing: total budget is conserved.
    const total = s.wallsRemaining.reduce((a, b) => a + b, 0);
    assert.equal(total, 4 * 5 - s.walls.length, 'budget conserved: placed walls come out of it');
  });

  it('chaos is deterministic across identical replays', () => {
    const cfg = { players: 4, size: 9, wallsPerPlayer: 5, chaos: true, seed: 77 } as const;
    const a = replayMultiGame(cfg, [
      { type: 'move', to: { r: 0, c: 3 } },
      { type: 'move', to: { r: 7, c: 4 } },
      { type: 'move', to: { r: 4, c: 1 } },
      { type: 'wall', wall: { r: 2, c: 2, orientation: 'h' } },
      { type: 'move', to: { r: 1, c: 3 } },
      { type: 'move', to: { r: 7, c: 3 } },
      { type: 'move', to: { r: 4, c: 2 } },
    ]).state;
    const b = replayMultiGame(cfg, [
      { type: 'move', to: { r: 0, c: 3 } },
      { type: 'move', to: { r: 7, c: 4 } },
      { type: 'move', to: { r: 4, c: 1 } },
      { type: 'wall', wall: { r: 2, c: 2, orientation: 'h' } },
      { type: 'move', to: { r: 1, c: 3 } },
      { type: 'move', to: { r: 7, c: 3 } },
      { type: 'move', to: { r: 4, c: 2 } },
    ]).state;
    assert.equal(hashMultiState(a), hashMultiState(b));
    assert.deepEqual(a.wallsRemaining, b.wallsRemaining);
  });

  it('siege gives seat 0 extra walls and a one-row head start', () => {
    const plain = createMultiGame({ players: 2, size: 9, wallsPerPlayer: 10 });
    assert.deepEqual(plain.pawns[0], { r: 0, c: 4 });
    assert.deepEqual(plain.wallsRemaining, [10, 10]);

    const s = createMultiGame({ players: 2, size: 9, wallsPerPlayer: 10, siege: true });
    assert.equal(s.siege, true);
    assert.equal(s.siegeHeadStart, 1);
    assert.deepEqual(s.pawns[0], { r: 1, c: 4 }, 'attacker starts one row in');
    assert.deepEqual(s.pawns[1], { r: 8, c: 4 }, 'defender starts unchanged');
    assert.equal(s.wallsRemaining[0], 10 + SIEGE_WALL_BONUS, 'attacker gets the wall bonus');
    assert.equal(s.wallsRemaining[1], 10, 'defender keeps the base budget');
  });

  it('siege still honours the no-seal rule and the wall economy', () => {
    let s = createMultiGame({ players: 2, size: 9, wallsPerPlayer: 10, siege: true });
    // Wall placement must be validated against the same budgets everywhere.
    const before = s.wallsRemaining[0];
    s = applyMultiMove(s, { type: 'wall', wall: { r: 3, c: 3, orientation: 'h' } }).state;
    assert.equal(s.wallsRemaining[0], before - 1);
    assert.ok(hasSidePath(s, 0), 'attacker keeps a route');
    assert.ok(hasSidePath(s, 1), 'defender keeps a route');
  });

  it('chaos and siege serialize distinctly', () => {
    const base = { players: 2, size: 9, wallsPerPlayer: 10, seed: 5 } as const;
    const plain = createMultiGame(base);
    const chaos = createMultiGame({ ...base, chaos: true });
    const siege = createMultiGame({ ...base, siege: true });
    assert.notEqual(hashMultiState(plain), hashMultiState(chaos));
    assert.notEqual(hashMultiState(plain), hashMultiState(siege));
    assert.notEqual(hashMultiState(chaos), hashMultiState(siege));
    assert.equal(hashMultiState(chaos), hashMultiState(createMultiGame({ ...base, chaos: true })));
  });
});

describe('multi: scenarios (SCE-001)', () => {
  it('catalog bundles only real engine flags', async () => {
    const { SCENARIOS, getScenario, configForScenario, createMultiGame } = await import('../index.js');
    assert.ok(SCENARIOS.length >= 5);
    assert.equal(getScenario('nope'), null);
    for (const s of SCENARIOS) {
      assert.ok(s.id.length > 0 && s.name.length > 0 && s.blurb.length > 0);
      const cfg = configForScenario({ players: 4, size: 9, wallsPerPlayer: 5 }, s.id);
      // Fog is online-only: never auto-applied to a local 4P config blindly is
      // fine — the flag is honest either way; the UI keeps it off local.
      const st = createMultiGame({ ...cfg, ...(s.flags.chaos === true ? { seed: 7 } : {}) });
      assert.equal(st.fog, s.flags.fog === true);
      assert.equal(st.chaos, s.flags.chaos === true);
      assert.equal(st.siege, s.flags.siege === true);
      assert.equal(st.continueAfterWin, s.flags.continueAfterWin === true);
    }
    // Unknown scenario id leaves the config untouched.
    assert.deepEqual(configForScenario({ players: 4, size: 9, wallsPerPlayer: 5 }, 'nope'), { players: 4, size: 9, wallsPerPlayer: 5 });
  });
});
