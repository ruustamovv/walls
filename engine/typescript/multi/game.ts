/**
 * N-player lifecycle: create / validate / apply (pure) / serialize /
 * hash / replay. Turns rotate; reaching your goal side wins immediately.
 */
import { isInBoundsCell } from '../core/board.js';
import { defaultSides, isGoal, startFor } from './board.js';
import { getMultiLegalMoves } from './moves.js';
import { validateMultiWall } from './walls.js';
import {
  MULTI_RULES_VERSION,
  type MultiAction,
  type MultiConfig,
  type MultiState,
  type MultiValidation,
  type MultiWall,
  type SeatSide,
} from './types.js';

export function createMultiGame(config: MultiConfig, seed?: number): MultiState {
  const { players, size } = config;
  if (!Number.isInteger(players) || players < 2 || players > 4) {
    throw new Error(`Invalid player count ${String(players)}: expected 2-4`);
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
  const resolvedSeed = seed ?? config.seed;
  return {
    size,
    wallsPerPlayer: walls,
    players,
    sides: [...sides],
    turn: 0,
    pawns: sides.map((s) => startFor(s, size)),
    walls: [],
    wallsRemaining: Array.from({ length: players }, () => walls),
    winner: null,
    isOver: false,
    moveNumber: 0,
    lastAction: null,
    rulesVersion: config.rulesVersion ?? MULTI_RULES_VERSION,
    ...(resolvedSeed === undefined ? {} : { seed: resolvedSeed }),
  };
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
  events: ('move_made' | 'wall_placed' | 'turn_passed' | 'game_won')[];
}

function cloneAction(action: MultiAction): MultiAction {
  return action.type === 'move'
    ? { type: 'move', to: { ...action.to } }
    : { type: 'wall', wall: { ...action.wall } };
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
    moveNumber: state.moveNumber + 1,
    lastAction: cloneAction(action),
  };
  const events: MultiApplyResult['events'] = [];
  if (action.type === 'move') {
    next.pawns[player] = { r: action.to.r, c: action.to.c };
    events.push('move_made');
    if (isGoal(side, state.size, action.to)) {
      next.winner = player;
      next.isOver = true;
      events.push('game_won');
    } else {
      next.turn = (player + 1) % state.players;
      events.push('turn_passed');
    }
  } else {
    next.walls.push({ ...(action.wall as MultiWall) });
    next.wallsRemaining[player] = (next.wallsRemaining[player] ?? 0) - 1;
    next.turn = (player + 1) % state.players;
    events.push('wall_placed', 'turn_passed');
  }
  return { state: next, events };
}

export function isMultiGameOver(state: MultiState): boolean {
  return state.isOver;
}

/** Stable serialization (canonical key order, sorted walls). */
export function serializeMultiState(state: MultiState): string {
  const ordered = {
    isOver: state.isOver,
    lastAction: state.lastAction === null ? null : cloneAction(state.lastAction),
    moveNumber: state.moveNumber,
    pawns: state.pawns.map((p) => ({ ...p })),
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
