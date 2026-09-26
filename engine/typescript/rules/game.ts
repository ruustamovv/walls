/**
 * Game lifecycle: creation, validation, pure transitions, hashing,
 * (de)serialization and replay. applyMove never mutates its input.
 */
import { goalRowFor, isInBoundsCell, startPosFor } from '../core/board.js';
import {
  RULES_VERSION,
  type Action,
  type ApplyResult,
  type GameConfig,
  type GameEvent,
  type GameState,
  type PlayerIndex,
  type Pos,
  type ValidationResult,
} from '../core/types.js';
import { getLegalMoves as legalPawnMoves } from './moves.js';
import { validateWall } from './walls.js';

/** Legal pawn destinations for a player (defaults to the side to move). */
export function getLegalMoves(state: GameState, player: PlayerIndex = state.turn): Pos[] {
  return legalPawnMoves(state, player);
}

/** Build a fresh game. Throws on invalid config (size < 5, bad wall count). */
export function createGame(config: GameConfig, seed?: number): GameState {
  const { size } = config;
  if (!Number.isInteger(size) || size < 5) {
    throw new Error(`Invalid board size ${String(size)}: expected integer >= 5`);
  }
  const walls = config.startingWalls ?? config.wallsPerPlayer;
  if (!Number.isInteger(walls) || walls < 0) {
    throw new Error(`Invalid wall count ${String(walls)}: expected integer >= 0`);
  }
  const resolvedSeed = seed ?? config.seed;
  return {
    size,
    wallsPerPlayer: walls,
    turn: 0,
    pawns: [startPosFor(0, size), startPosFor(1, size)],
    walls: [],
    wallsRemaining: [walls, walls],
    winner: null,
    isOver: false,
    moveNumber: 0,
    lastAction: null,
    rulesVersion: config.rulesVersion ?? RULES_VERSION,
    ...(resolvedSeed === undefined ? {} : { seed: resolvedSeed }),
  };
}

/** Check an action for the side to move without applying it. */
export function validateMove(state: GameState, action: Action): ValidationResult {
  if (state.isOver) return { ok: false, reason: 'game_over' };
  if (action === null || typeof action !== 'object' || typeof action.type !== 'string') {
    return { ok: false, reason: 'invalid_action' };
  }
  const player = state.turn;

  if (action.type === 'move') {
    const to = action.to;
    if (to === null || typeof to !== 'object' || !isInBoundsCell(to, state.size)) {
      return { ok: false, reason: 'out_of_bounds' };
    }
    const legal = legalPawnMoves(state, player);
    const found = legal.some((p) => p.r === to.r && p.c === to.c);
    return found ? { ok: true } : { ok: false, reason: 'illegal_move' };
  }

  if (action.type === 'wall') {
    const wall = action.wall;
    if (wall === null || typeof wall !== 'object') {
      return { ok: false, reason: 'invalid_action' };
    }
    return validateWall(state, player, wall);
  }

  return { ok: false, reason: 'invalid_action' };
}

/**
 * Apply an action and return the next state plus emitted events.
 * PURE: the input state is never mutated. Throws on invalid actions.
 */
export function applyMove(state: GameState, action: Action): ApplyResult {
  const verdict = validateMove(state, action);
  if (!verdict.ok) {
    throw new Error(`Invalid action (${verdict.reason ?? 'unknown'})`);
  }

  const player: PlayerIndex = state.turn;
  const next: GameState = {
    ...state,
    turn: state.turn,
    pawns: [
      { ...state.pawns[0] },
      { ...state.pawns[1] },
    ],
    walls: state.walls.map((w) => ({ ...w })),
    wallsRemaining: [...state.wallsRemaining] as [number, number],
    moveNumber: state.moveNumber + 1,
    lastAction: cloneAction(action),
  };
  const events: GameEvent[] = [];
  const other = (1 - player) as PlayerIndex;

  if (action.type === 'move') {
    next.pawns[player] = { r: action.to.r, c: action.to.c };
    events.push('move_made');
    if (action.to.r === goalRowFor(player, state.size)) {
      next.winner = player;
      next.isOver = true;
      events.push('game_won');
    } else {
      next.turn = other;
      events.push('turn_switched');
    }
  } else {
    next.walls.push({ ...action.wall });
    next.wallsRemaining[player] -= 1;
    next.turn = other;
    events.push('wall_placed', 'turn_switched');
  }

  return { state: next, events };
}

/** True once a pawn has reached its goal row. */
export function isGameOver(state: GameState): boolean {
  return state.isOver;
}

/** Compare two walls for canonical ordering (r, c, orientation). */
function compareWalls(a: { r: number; c: number; orientation: string }, b: { r: number; c: number; orientation: string }): number {
  if (a.r !== b.r) return a.r - b.r;
  if (a.c !== b.c) return a.c - b.c;
  return a.orientation < b.orientation ? -1 : a.orientation > b.orientation ? 1 : 0;
}

function cloneAction(action: Action): Action {
  return action.type === 'move'
    ? { type: 'move', to: { r: action.to.r, c: action.to.c } }
    : { type: 'wall', wall: { r: action.wall.r, c: action.wall.c, orientation: action.wall.orientation } };
}

/**
 * Stable JSON encoding: fixed top-level key order, walls sorted, nested
 * action rebuilt in canonical order. Two structurally equal states always
 * produce the same string regardless of object key insertion order.
 */
export function serializeState(state: GameState): string {
  const ordered = {
    isOver: state.isOver,
    lastAction: state.lastAction === null ? null : cloneAction(state.lastAction),
    moveNumber: state.moveNumber,
    pawns: [{ ...state.pawns[0] }, { ...state.pawns[1] }],
    rulesVersion: state.rulesVersion,
    seed: state.seed ?? null,
    size: state.size,
    turn: state.turn,
    walls: state.walls.map((w) => ({ ...w })).sort(compareWalls),
    wallsPerPlayer: state.wallsPerPlayer,
    wallsRemaining: [...state.wallsRemaining],
    winner: state.winner,
  };
  return JSON.stringify(ordered);
}

/** Parse + shape-check a serialized state. Throws on malformed input. */
export function deserializeState(json: string): GameState {
  let raw: unknown;
  try {
    raw = JSON.parse(json) as unknown;
  } catch {
    throw new Error('Malformed state JSON');
  }
  if (raw === null || typeof raw !== 'object') throw new Error('Malformed state: not an object');
  const o = raw as Record<string, unknown>;

  const size = o['size'];
  const wallsPerPlayer = o['wallsPerPlayer'];
  if (!Number.isInteger(size) || (size as number) < 5) throw new Error('Malformed state: bad size');
  if (!Number.isInteger(wallsPerPlayer) || (wallsPerPlayer as number) < 0) {
    throw new Error('Malformed state: bad wallsPerPlayer');
  }
  const turn = o['turn'];
  if (turn !== 0 && turn !== 1) throw new Error('Malformed state: bad turn');

  const pawns = o['pawns'];
  if (!Array.isArray(pawns) || pawns.length !== 2) throw new Error('Malformed state: bad pawns');
  const n = size as number;
  const pos = (v: unknown): Pos => {
    if (v === null || typeof v !== 'object') throw new Error('Malformed state: bad pos');
    const p = v as Record<string, unknown>;
    if (!Number.isInteger(p['r']) || !Number.isInteger(p['c'])) {
      throw new Error('Malformed state: bad pos coords');
    }
    const r = p['r'] as number;
    const c = p['c'] as number;
    if (r < 0 || c < 0 || r >= n || c >= n) throw new Error('Malformed state: pos out of bounds');
    return { r, c };
  };

  const walls = o['walls'];
  if (!Array.isArray(walls)) throw new Error('Malformed state: bad walls');
  const wallList = (walls as unknown[]).map((v) => {
    if (v === null || typeof v !== 'object') throw new Error('Malformed state: bad wall');
    const w = v as Record<string, unknown>;
    if (w['orientation'] !== 'h' && w['orientation'] !== 'v') {
      throw new Error('Malformed state: bad wall orientation');
    }
    if (!Number.isInteger(w['r']) || !Number.isInteger(w['c'])) {
      throw new Error('Malformed state: bad wall coords');
    }
    const wr = w['r'] as number;
    const wc = w['c'] as number;
    if (wr < 0 || wc < 0 || wr > n - 2 || wc > n - 2) {
      throw new Error('Malformed state: wall out of bounds');
    }
    return { r: wr, c: wc, orientation: w['orientation'] as 'h' | 'v' };
  });

  const rem = o['wallsRemaining'];
  if (!Array.isArray(rem) || rem.length !== 2) throw new Error('Malformed state: bad wallsRemaining');
  const wallsRemaining = rem as unknown[];
  if (!wallsRemaining.every((x) => Number.isInteger(x) && (x as number) >= 0)) {
    throw new Error('Malformed state: bad wallsRemaining values');
  }

  const winner = o['winner'];
  if (winner !== null && winner !== 0 && winner !== 1) {
    throw new Error('Malformed state: bad winner');
  }
  if (typeof o['isOver'] !== 'boolean') throw new Error('Malformed state: bad isOver');
  if (!Number.isInteger(o['moveNumber']) || (o['moveNumber'] as number) < 0) {
    throw new Error('Malformed state: bad moveNumber');
  }
  if (typeof o['rulesVersion'] !== 'string') throw new Error('Malformed state: bad rulesVersion');

  let lastAction: GameState['lastAction'] = null;
  if (o['lastAction'] !== null && o['lastAction'] !== undefined) {
    const la = o['lastAction'] as Record<string, unknown>;
    if (la['type'] === 'move') {
      lastAction = { type: 'move', to: pos(la['to']) };
    } else if (la['type'] === 'wall') {
      const w = la['wall'] as Record<string, unknown>;
      lastAction = {
        type: 'wall',
        wall: {
          r: w['r'] as number,
          c: w['c'] as number,
          orientation: w['orientation'] as 'h' | 'v',
        },
      };
    } else {
      throw new Error('Malformed state: bad lastAction');
    }
  }

  const state: GameState = {
    size: n,
    wallsPerPlayer: wallsPerPlayer as number,
    turn: turn as PlayerIndex,
    pawns: [pos(pawns[0]), pos(pawns[1])],
    walls: wallList,
    wallsRemaining: [wallsRemaining[0] as number, wallsRemaining[1] as number],
    winner: winner as null | PlayerIndex,
    isOver: o['isOver'] as boolean,
    moveNumber: o['moveNumber'] as number,
    lastAction,
    rulesVersion: o['rulesVersion'] as string,
  };
  const seed = o['seed'];
  if (typeof seed === 'number') state.seed = seed;
  return state;
}

/**
 * Deterministic FNV-1a 32-bit hash of the canonical serialization,
 * rendered as 8 lowercase hex chars. Synchronous and dependency-free
 * (chosen over node:crypto so the engine stays portable to browsers).
 */
export function hashState(state: GameState): string {
  const s = serializeState(state);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** Re-apply an action list from a fresh game; returns final state + all events. */
export function replayGame(
  config: GameConfig,
  actions: readonly Action[],
  seed?: number,
): ApplyResult {
  let state = createGame(config, seed);
  const events: GameEvent[] = [];
  for (const action of actions) {
    const r = applyMove(state, action);
    state = r.state;
    events.push(...r.events);
  }
  return { state, events };
}
