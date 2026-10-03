/**
 * N-player lifecycle: create / validate / apply (pure) / serialize /
 * hash / replay. Turns rotate; reaching your goal side wins immediately.
 */
import { isInBoundsCell } from '../core/board.js';
import { defaultSides, isGoal, startFor } from './board.js';
import { getMultiLegalMoves } from './moves.js';
import { validateMultiWall } from './walls.js';
import {
  CHAOS_ROTATION_PLIES,
  MULTI_RULES_VERSION,
  SIEGE_WALL_BONUS,
  type MultiAction,
  type MultiConfig,
  type MultiPos,
  type MultiState,
  type MultiValidation,
  type MultiWall,
  type SeatSide,
} from './types.js';

export function createMultiGame(config: MultiConfig, seed?: number): MultiState {
  const { players, size } = config;
  if (!Number.isInteger(players) || players < 2 || players > 6) {
    throw new Error(`Invalid player count ${String(players)}: expected 2-6`);
  }
  if (!Number.isInteger(size) || size < 5) {
    throw new Error(`Invalid board size ${String(size)}: expected integer >= 5`);
  }
  const walls = config.wallsPerPlayer;
  if (!Number.isInteger(walls) || walls < 0) {
    throw new Error(`Invalid wall count ${String(walls)}: expected integer >= 0`);
  }
  const sides = config.sides ?? defaultSides(players);
  if (sides.length !== players) throw new Error('sides length must equal player count');
  const seen = new Map<SeatSide, number>();
  // Siege (MLT-009): the attacking seat starts one row closer to its goal.
  const siegeHeadStart = config.siege === true ? 1 : 0;
  const pawns = sides.map((s, seat) => {
    const o = seen.get(s) ?? 0;
    seen.set(s, o + 1);
    const start = startFor(s, size, o);
    if (siegeHeadStart > 0 && seat === 0 && s === 'S') {
      return { r: Math.min(size - 1, start.r + siegeHeadStart), c: start.c } satisfies MultiPos;
    }
    return start;
  });
  for (let i = 0; i < pawns.length; i++) {
    for (let j = i + 1; j < pawns.length; j++) {
      const a = pawns[i] as MultiPos;
      const b = pawns[j] as MultiPos;
      if (a.r === b.r && a.c === b.c) throw new Error('duplicate start cells: sides need distinct lanes');
    }
  }
  const teamMode = config.teamMode === true;
  if (teamMode && (players !== 2 && players !== 4)) {
    throw new Error(`Team mode needs 2 or 4 seats, got ${String(players)}`);
  }
  if (teamMode && config.continueAfterWin === true) {
    throw new Error('Team mode and continue-after-win are mutually exclusive');
  }
  const resolvedSeed = seed ?? config.seed;
  const chaos = config.chaos === true;
  // Chaos must be reproducible from the action log alone, so a seed is
  // mandatory — `replayMultiGame` has nothing else to reconstruct it from.
  if (chaos && resolvedSeed === undefined) {
    throw new Error('Chaos mode requires a seed for deterministic replay');
  }
  const siege = config.siege === true;
  return {
    size,
    wallsPerPlayer: walls,
    players,
    sides: [...sides],
    turn: 0,
    pawns,
    walls: [],
    // Siege gives the attacker extra walls; everyone else keeps the base budget.
    wallsRemaining: Array.from({ length: players }, (_, seat) =>
      siege && seat === 0 ? walls + SIEGE_WALL_BONUS : walls),
    winner: null,
    isOver: false,
    moveNumber: 0,
    lastAction: null,
    rulesVersion: config.rulesVersion ?? MULTI_RULES_VERSION,
    ...(resolvedSeed === undefined ? {} : { seed: resolvedSeed }),
    continueAfterWin: config.continueAfterWin === true,
    eliminated: [],
    placement: [],
    teamOf: teamMode ? seatTeams(players) : null,
    winningTeam: null,
    fog: config.fog === true,
    chaos,
    siege,
    siegeHeadStart,
  };
}

/**
 * Seat -> team index. Teams interleave so adjacent turns are NOT teammates
 * (4P: seats 0+2 vs 1+3), which is the standard 2v2 wall-and-pawn setup.
 */
export function seatTeams(players: number): number[] {
  if (players === 2) return [0, 1];
  return Array.from({ length: players }, (_, i) => i % 2);
}

export function validateMultiMove(state: MultiState, action: MultiAction): MultiValidation {
  if (state.isOver) return { ok: false, reason: 'game_over' };
  if (action === null || typeof action !== 'object') return { ok: false, reason: 'invalid_action' };
  const player = state.turn;
  if (action.type === 'move') {
    const to = action.to;
    if (to === null || typeof to !== 'object' || !isInBoundsCell(to, state.size)) {
      return { ok: false, reason: 'out_of_bounds' };
    }
    const found = getMultiLegalMoves(state, player).some((p) => p.r === to.r && p.c === to.c);
    return found ? { ok: true } : { ok: false, reason: 'illegal_move' };
  }
  if (action.type === 'wall') {
    if (action.wall === null || typeof action.wall !== 'object') return { ok: false, reason: 'invalid_action' };
    return validateMultiWall(state, player, action.wall);
  }
  return { ok: false, reason: 'invalid_action' };
}

export interface MultiApplyResult {
  state: MultiState;
  events: ('move_made' | 'wall_placed' | 'turn_passed' | 'game_won' | 'seat_eliminated' | 'chaos_rotation')[];
}

function cloneAction(action: MultiAction): MultiAction {
  return action.type === 'move'
    ? { type: 'move', to: { ...action.to } }
    : { type: 'wall', wall: { ...action.wall } };
}

/** Advance turn to the next seat still in rotation (skips eliminated seats). */
function advanceTurn(state: MultiState, from: number): number {
  for (let step = 1; step <= state.players; step++) {
    const next = (from + step) % state.players;
    if (!state.eliminated.includes(next)) return next;
  }
  return from;
}

/** Pure transition. Throws on invalid actions. */
export function applyMultiMove(state: MultiState, action: MultiAction): MultiApplyResult {
  const verdict = validateMultiMove(state, action);
  if (!verdict.ok) throw new Error(`Invalid action (${verdict.reason ?? 'unknown'})`);
  const player = state.turn;
  const side = state.sides[player] as SeatSide;
  const next: MultiState = {
    ...state,
    sides: [...state.sides],
    pawns: state.pawns.map((p) => ({ ...p })),
    walls: state.walls.map((w) => ({ ...w })),
    wallsRemaining: [...state.wallsRemaining],
    eliminated: [...state.eliminated],
    placement: [...state.placement],
    moveNumber: state.moveNumber + 1,
    lastAction: cloneAction(action),
  };
  const events: MultiApplyResult['events'] = [];
  if (action.type === 'move') {
    next.pawns[player] = { r: action.to.r, c: action.to.c };
    events.push('move_made');
    if (isGoal(side, state.size, action.to)) {
      if (state.continueAfterWin) {
        // Record finish order and remove from rotation; game continues
        // while more than one active seat remains.
        next.eliminated.push(player);
        next.placement.push(player);
        events.push('seat_eliminated');
        const active = next.players - next.eliminated.length;
        if (active <= 1) {
          // Final active seat(s) take the remaining placement slots.
          for (let s = 0; s < next.players; s++) {
            if (!next.eliminated.includes(s)) {
              next.eliminated.push(s);
              next.placement.push(s);
            }
          }
          next.isOver = true;
          next.winner = next.placement[0] ?? player;
          events.push('game_won');
        } else {
          next.turn = advanceTurn(next, player);
          events.push('turn_passed');
        }
      } else if (next.teamOf !== null) {
        // Team mode (MLT-009): first seat home wins for the whole team.
        // winnerSeat records WHICH seat finished; winningTeam carries the
        // team so both teammates (and the UI) see the same result.
        next.winner = player;
        next.winningTeam = next.teamOf[player] ?? 0;
        next.placement = [player, ...Array.from({ length: state.players }, (_, i) => i).filter((i) => i !== player)];
        next.isOver = true;
        events.push('game_won');
      } else {
        next.winner = player;
        next.isOver = true;
        events.push('game_won');
      }
    } else {
      next.turn = advanceTurn(next, player);
      events.push('turn_passed');
    }
  } else {
    // Owner stamp (see rules/game.ts): the seat to move owns its walls.
    next.walls.push({ ...(action.wall as MultiWall), by: player });
    next.wallsRemaining[player] = (next.wallsRemaining[player] ?? 0) - 1;
    next.turn = advanceTurn(next, player);
    events.push('wall_placed', 'turn_passed');
  }
  // Chaos (MLT-009): on a fixed cadence the wall budget rotates between the
  // seat that has the most and the seat that has the least, so no one can
  // bank an arsenal. Deterministic: derived only from moveNumber + totals.
  if (next.chaos && !next.isOver && (next.moveNumber + 1) % CHAOS_ROTATION_PLIES === 0) {
    rotateChaosWallBudget(next);
    events.push('chaos_rotation');
  }
  return { state: next, events };
}

/**
 * Chaos rotation: move one wall from the richest seat to the poorest.
 * Mutates `state.wallsRemaining` in place (caller owns the copy).
 */
function rotateChaosWallBudget(state: MultiState): void {
  let richest = 0;
  let poorest = 0;
  for (let i = 1; i < state.players; i++) {
    if ((state.wallsRemaining[i] ?? 0) > (state.wallsRemaining[richest] ?? 0)) richest = i;
    if ((state.wallsRemaining[i] ?? 0) < (state.wallsRemaining[poorest] ?? 0)) poorest = i;
  }
  if (richest === poorest) return;
  if ((state.wallsRemaining[richest] ?? 0) <= 0) return; // nothing to give
  state.wallsRemaining[richest] = (state.wallsRemaining[richest] ?? 0) - 1;
  state.wallsRemaining[poorest] = (state.wallsRemaining[poorest] ?? 0) + 1;
}

export function isMultiGameOver(state: MultiState): boolean {
  return state.isOver;
}

/** Seats belonging to the same team as `seat` (empty in free-for-all). */
export function teamMates(state: MultiState, seat: number): number[] {
  if (state.teamOf === null) return [];
  const team = state.teamOf[seat];
  return state.teamOf.map((t, i) => ({ t, i })).filter((x) => x.t === team && x.i !== seat).map((x) => x.i);
}

/** Stable serialization (canonical key order, sorted walls). */
export function serializeMultiState(state: MultiState): string {
  const ordered = {
    chaos: state.chaos,
    continueAfterWin: state.continueAfterWin,
    fog: state.fog,
    siege: state.siege,
    siegeHeadStart: state.siegeHeadStart,
    teamOf: state.teamOf === null ? null : [...state.teamOf],
    winningTeam: state.winningTeam,
    eliminated: [...state.eliminated],
    isOver: state.isOver,
    lastAction: state.lastAction === null ? null : cloneAction(state.lastAction),
    moveNumber: state.moveNumber,
    pawns: state.pawns.map((p) => ({ ...p })),
    placement: [...state.placement],
    players: state.players,
    rulesVersion: state.rulesVersion,
    seed: state.seed ?? null,
    sides: [...state.sides],
    size: state.size,
    turn: state.turn,
    walls: state.walls.map((w) => ({ ...w })).sort((a, b) =>
      a.r !== b.r ? a.r - b.r : a.c !== b.c ? a.c - b.c : a.orientation < b.orientation ? -1 : 1,
    ),
    wallsPerPlayer: state.wallsPerPlayer,
    wallsRemaining: [...state.wallsRemaining],
    winner: state.winner,
  };
  return JSON.stringify(ordered);
}

/** Deterministic FNV-1a hash (browser-safe, no node:crypto). */
export function hashMultiState(state: MultiState): string {
  const s = serializeMultiState(state);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** Re-apply an action list from a fresh game. */
export function replayMultiGame(config: MultiConfig, actions: readonly MultiAction[], seed?: number): MultiApplyResult {
  let state = createMultiGame(config, seed);
  const events: MultiApplyResult['events'] = [];
  for (const action of actions) {
    const r = applyMultiMove(state, action);
    state = r.state;
    events.push(...r.events);
  }
  return { state, events };
}
