/**
 * Multiplayer (2–6 seats) wall-and-pawn engine.
 *
 * The classic 2P engine in ../core+../rules is untouched; this module
 * generalizes the same Quoridor rules to N seats: every pawn races for its
 * own goal SIDE, turns rotate, walls must preserve a route for EVERY pawn.
 * 5P/6P share edges (S, then N) with offset start lanes since a square has
 * four edges. Online 4P arrives later — local and bot play work today.
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
  /** Seats at the table: 2, 3, 4 or 5. */
  players: number;
  size: number;
  wallsPerPlayer: number;
  /** Goal sides in seat order. 2P [S,N], 3P [S,E,W], 4P [S,N,E,W], 5P +S, 6P +S+N. */
  sides?: SeatSide[];
  rulesVersion?: string;
  seed?: number;
  /**
   * Opt-in continuation (MLT-007): when true, a seat reaching its goal is
   * recorded in finish order and removed from turn rotation instead of
   * ending the game. The game ends when ≤1 active seat remains.
   * Default false — first goal wins, exactly as before.
   */
  continueAfterWin?: boolean;
  /**
   * Opt-in team rules (MLT-009): seats are split into two teams and the
   * FIRST seat to reach its goal wins for its whole team. Requires an even
   * seat count (2 or 4). Default false — free-for-all, exactly as before.
   * Mutually exclusive with continueAfterWin (a race has one finisher).
   */
  teamMode?: boolean;
  /**
   * Opt-in fog of war (MLT-009): each seat only sees walls adjacent to its own
   * pawn. The SERVER must project snapshots per seat (see multi/fog.ts) — a
   * shared broadcast would leak the whole board and defeat the mode.
   * Default false — full visibility, exactly as before.
   */
  fog?: boolean;
  /**
   * Opt-in chaos (MLT-009): wall budgets rotate every CHAOS_ROTATION_PLIES
   * moves so no seat can bank a wall arsenal. Requires a `seed` (or an explicit
   * seed argument) because the rotation must be replayable from the action log
   * alone — an unseeded random rotation could not be reconstructed by
   * `replayMultiGame`, which would break replay determinism.
   */
  chaos?: boolean;
  /**
   * Opt-in siege (MLT-009): asymmetric wall economy. Seat 0 (the attacker) gets
   * SIEGE_WALL_BONUS extra walls and a one-row head start; everyone else plays
   * the normal economy. Casual-only, never in ranked play.
   */
  siege?: boolean;
}

/** Chaos: how often the wall budget rotates (in plies). */
export const CHAOS_ROTATION_PLIES = 6;
/** Siege: extra walls for the attacking seat. */
export const SIEGE_WALL_BONUS = 4;

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
  /** Five-player free-for-all: roomy 19x19, shared S edge. */
  party5: { players: 5, size: 19, wallsPerPlayer: 8 },
  /** Six-player free-for-all: grand 21x21, shared S+N edges. */
  party6: { players: 6, size: 21, wallsPerPlayer: 8 },
  /**
   * Team duel 2v2 (MLT-009): seats 0+2 vs 1+3. First seat home wins for its
   * team. The sides layout is identical to party4 so only the team flag
   * differs — an apples-to-apples team game.
   */
  team4: { players: 4, size: 9, wallsPerPlayer: 5 },
} as const;

/**
 * Canonical default preset per player count (MLT-006): the single source
 * backends and frontends derive quick-match defaults from, so scaling
 * stays consistent everywhere. Values are initial balancing (see
 * docs/game-rules/multi-balance.md), adjustable per mode.
 */
export function presetForPlayers(players: number): { size: number; wallsPerPlayer: number } {
  if (players <= 2) return { size: MULTI_PRESETS.duel.size, wallsPerPlayer: MULTI_PRESETS.duel.wallsPerPlayer };
  if (players === 3) return { size: MULTI_PRESETS.trio13.size, wallsPerPlayer: MULTI_PRESETS.trio13.wallsPerPlayer };
  if (players === 5) return { size: MULTI_PRESETS.party5.size, wallsPerPlayer: MULTI_PRESETS.party5.wallsPerPlayer };
  if (players >= 6) return { size: MULTI_PRESETS.party6.size, wallsPerPlayer: MULTI_PRESETS.party6.wallsPerPlayer };
  return { size: MULTI_PRESETS.party4.size, wallsPerPlayer: MULTI_PRESETS.party4.wallsPerPlayer };
}

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
  /** Opt-in continuation mode (MLT-007). */
  continueAfterWin: boolean;
  /** Seats that reached their goal and left rotation (finish order). */
  eliminated: number[];
  /** Winner-first seat order once isOver. */
  placement: number[];
  /** Team index per seat (MLT-009). Null when free-for-all. */
  teamOf: number[] | null;
  /** Winning team index in team mode, else null. */
  winningTeam: number | null;
  /** Fog of war active (MLT-009): snapshots must be projected per seat. */
  fog: boolean;
  /** Chaos mode active (MLT-009): wall budget rotates on a fixed cadence. */
  chaos: boolean;
  /** Siege mode active (MLT-009): seat 0 has extra walls and a head start. */
  siege: boolean;
  /** Siege: the row seat 0's pawn starts on instead of row 0. */
  siegeHeadStart: number;
}

export type MultiRejectReason =
  | 'game_over'
  | 'out_of_bounds'
  | 'illegal_move'
  | 'no_walls_remaining'
  | 'duplicate_wall'
  | 'crossing_wall'
  | 'overlapping_wall'
  | 'blocks_path'
  | 'invalid_orientation'
  | 'invalid_action'
  | 'invalid_config';

export interface MultiValidation {
  ok: boolean;
  reason?: MultiRejectReason;
}
