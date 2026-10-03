/**
 * Core types for the PROJECT_NEXUS deterministic game engine.
 *
 * Coordinate conventions (fixed for all board sizes):
 * - Cells are addressed as { r, c } with 0 <= r,c < size. Row 0 is the TOP row.
 * - Player 0 starts on the TOP row (r = 0) and aims for the BOTTOM row (r = size-1).
 * - Player 1 starts on the BOTTOM row (r = size-1) and aims for the TOP row (r = 0).
 * - Both pawns start in the middle column, mid = floor(size / 2).
 * - Wall slots are addressed as { r, c } with 0 <= r,c < size-1, plus orientation.
 */

/** Zero-based board cell coordinates. */
export interface Pos {
  r: number;
  c: number;
}

/** Wall orientation: 'h' spans horizontally (blocks vertical movement),
 *  'v' spans vertically (blocks horizontal movement). */
export type Orientation = 'h' | 'v';

/** A wall placement on the wall grid (0 <= r,c <= size-2). */
export interface Wall {
  r: number;
  c: number;
  orientation: Orientation;
  /** Seat that placed the wall (stamped by applyMove; absent on hand-built boards). */
  by?: PlayerIndex;
}

/**
 * Structural wall shape for geometry helpers: position + orientation only.
 * Both Wall and MultiWall satisfy it, so shared geometry never cares who
 * placed a wall — only where it sits.
 */
export interface WallShape {
  r: number;
  c: number;
  orientation: Orientation;
}

/** Player identifier: 0 = top starter, 1 = bottom starter. */
export type PlayerIndex = 0 | 1;

/** Current rules version stamped on every game state. Bump on rule changes. */
export const RULES_VERSION = '1.0.0';

/** Named board configurations from the master spec. */
export const BOARD_PRESETS = {
  /** Classic duel: 9x9 board, 10 walls per player. */
  classic: { size: 9, wallsPerPlayer: 10 },
  /** Standard arena: 15x15 board, 20 walls per player. */
  standard: { size: 15, wallsPerPlayer: 20 },
  /** Siege arena: 17x17 board, 30 walls per player. */
  siege: { size: 17, wallsPerPlayer: 30 },
} as const;

/** Engine configuration. Any integer size >= 5 (odd or even) and any
 *  non-negative wall count are accepted; presets above are just shortcuts. */
export interface GameConfig {
  /** Board edge length in cells. Must be an integer >= 5. */
  size: number;
  /** Walls granted to EACH player at game start. Must be an integer >= 0. */
  wallsPerPlayer: number;
  /** Rules version to stamp on created states. Defaults to RULES_VERSION. */
  rulesVersion?: string;
  /**
   * Legacy alias for wallsPerPlayer. When defined it takes precedence.
   * Kept so serialized configs carrying `startingWalls` keep working.
   */
  startingWalls?: number;
  /** Optional deterministic seed recorded on the state (no RNG use yet). */
  seed?: number;
}

/** Complete, serializable snapshot of a game. */
export interface GameState {
  size: number;
  wallsPerPlayer: number;
  /** Player to act next. */
  turn: PlayerIndex;
  /** Pawn positions indexed by player. */
  pawns: [Pos, Pos];
  /** Placed walls in placement order. */
  walls: Wall[];
  /** Remaining wall inventory indexed by player. */
  wallsRemaining: [number, number];
  /** Winner once isOver is true, otherwise null. */
  winner: null | PlayerIndex;
  isOver: boolean;
  /** Number of actions applied so far (starts at 0). */
  moveNumber: number;
  /** Most recently applied action, or null before the first action. */
  lastAction: null | Action;
  rulesVersion: string;
  seed?: number;
}

/** A single turn action performed by the player in `state.turn`. */
export type Action = { type: 'move'; to: Pos } | { type: 'wall'; wall: Wall };

/** Outcome of validating an action without applying it. */
export interface ValidationResult {
  ok: boolean;
  /** Machine-readable failure code (present when ok is false). */
  reason?: string;
}

/** Discrete events emitted by applyMove, in emission order. */
export type GameEvent = 'move_made' | 'wall_placed' | 'turn_switched' | 'game_won';

/** Result of a pure state transition. */
export interface ApplyResult {
  state: GameState;
  events: GameEvent[];
}

/** Rejection reason codes used across validateMove / validateWall. */
export type RejectReason =
  | 'game_over'
  | 'out_of_bounds'
  | 'illegal_move'
  | 'no_walls_remaining'
  | 'duplicate_wall'
  | 'crossing_wall'
  | 'overlapping_wall'
  | 'blocks_path'
  | 'invalid_orientation'
  | 'invalid_action';
