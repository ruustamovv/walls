/**
 * Multiplayer (2–4 seats) wall-and-pawn engine.
 *
 * The classic 2P engine in ../core+../rules is untouched; this module
 * generalizes the same Quoridor rules to N seats: every pawn races for its
 * own goal SIDE, turns rotate, walls must preserve a route for EVERY pawn.
 * Online 4P arrives later — local and bot play work today.
 */

/** Goal side of a seat: the edge it must reach. */
export type SeatSide = 'N' | 'S' | 'E' | 'W';

export interface MultiPos {
  r: number;
  c: number;
}

export type MultiOrientation = 'h' | 'v';

export interface MultiWall {
  r: number;
  c: number;
  orientation: MultiOrientation;
}

export interface MultiConfig {
  /** Seats at the table: 2, 3 or 4. */
  players: number;
  size: number;
  wallsPerPlayer: number;
  /** Goal sides in seat order. Defaults: 2P [S,N], 3P [S,E,W], 4P [S,N,E,W]. */
  sides?: SeatSide[];
  rulesVersion?: string;
  seed?: number;
}

export const MULTI_RULES_VERSION = '1.0.0-m1';

export const MULTI_PRESETS = {
  /** Classic duel on the multi core (same geometry as classic). */
  duel: { players: 2, size: 9, wallsPerPlayer: 10 },
  /** Four-player chaos: 9x9, 5 walls each (classic 4P distribution). */
  party4: { players: 4, size: 9, wallsPerPlayer: 5 },
  /** Three-player: roomier 13x13 board. */
  trio13: { players: 3, size: 13, wallsPerPlayer: 10 },
  /** Grand melee: 15x15 four-player. */
  melee15: { players: 4, size: 15, wallsPerPlayer: 10 },
} as const;

export type MultiAction = { type: 'move'; to: MultiPos } | { type: 'wall'; wall: MultiWall };

export interface MultiState {
  size: number;
  wallsPerPlayer: number;
  players: number;
  sides: SeatSide[];
  turn: number;
  pawns: MultiPos[];
  walls: MultiWall[];
  wallsRemaining: number[];
  winner: number | null;
  isOver: boolean;
  moveNumber: number;
  lastAction: MultiAction | null;
  rulesVersion: string;
  seed?: number;
}

export type MultiRejectReason =
  | 'game_over'
  | 'out_of_bounds'
  | 'illegal_move'
  | 'no_walls_remaining'
  | 'duplicate_wall'
  | 'crossing_wall'
  | 'blocks_path'
  | 'invalid_orientation'
  | 'invalid_action'
  | 'invalid_config';

export interface MultiValidation {
  ok: boolean;
  reason?: MultiRejectReason;
}
