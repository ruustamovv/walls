/**
 * Fog of war visibility (MLT-009) — hidden opponent walls.
 *
 * The engine stays the single source of truth for WHAT is legal; this module
 * only answers "what may seat S see?". It is a pure projection: same state +
 * same viewer always yields the same visible set, and the server applies it
 * per seat before sending a snapshot. Nothing here mutates game state.
 *
 * Rule: a wall becomes visible to a seat once it lies next to that seat's own
 * pawn (Chebyshev distance 1 from either cell the wall separates). Walls
 * further away stay fogged until the game ends, when the full board is revealed
 * to everyone for review.
 *
 * Deliberately geometric rather than per-owner: the engine keeps walls in one
 * flat list without authorship, so "which seat placed this wall?" is not
 * answerable from state. Proximity is both answerable and fairer — you always
 * see the walls immediately around you.
 *
 * Wall and pawn POSITIONS are never hidden: every player must see the full grid
 * to make a legal decision, and hiding a pawn would break move validation. Only
 * the existence of distant walls is hidden.
 */
import { isInBoundsCell } from '../core/board.js';
import type { MultiPos, MultiState, MultiWall } from './types.js';

export const FOG_RULES_VERSION = '1.0.0-m1-fog';

/** Chebyshev distance <= 1: same cell or orthogonally/diagonally touching. */
export function pawnsAdjacent(a: MultiPos, b: MultiPos): boolean {
  return Math.abs(a.r - b.r) <= 1 && Math.abs(a.c - b.c) <= 1;
}

/** Wall covers the edge between two cells; adjacent if either cell touches. */
function wallTouches(wall: MultiWall, pawn: MultiPos, size: number): boolean {
  // A horizontal wall at (r,c) blocks between (r,c) and (r+1,c).
  // A vertical wall at (r,c) blocks between (r,c) and (r,c+1).
  const a: MultiPos = { r: wall.r, c: wall.c };
  const b: MultiPos = wall.orientation === 'h' ? { r: wall.r + 1, c: wall.c } : { r: wall.r, c: wall.c + 1 };
  if (!isInBoundsCell(b, size)) return false;
  return pawnsAdjacent(a, pawn) || pawnsAdjacent(b, pawn);
}

/**
 * Walls visible to `viewer`. Returns the subset the viewer is entitled to
 * see; the count difference is the fog payload.
 */
export function visibleWalls(state: MultiState, viewer: number): MultiWall[] {
  // Reveal everything once the game ends: there is nothing left to protect,
  // and players need the real board for review/replay.
  if (state.isOver) return state.walls.map((w) => ({ ...w }));
  if (viewer < 0 || viewer >= state.players) return state.walls.map((w) => ({ ...w }));

  const ownPawn = state.pawns[viewer];
  if (ownPawn === undefined) return [];
  const out: MultiWall[] = [];
  for (const wall of state.walls) {
    if (wallTouches(wall, ownPawn, state.size)) out.push({ ...wall });
  }
  return out;
}

/** How many walls are currently hidden from `viewer` (for UI counters). */
export function hiddenWallCount(state: MultiState, viewer: number): number {
  return state.walls.length - visibleWalls(state, viewer).length;
}

/** Per-seat visibility map, for tests and server fan-out. */
export function fogMap(state: MultiState): number[][] {
  return Array.from({ length: state.players }, (_, seat) =>
    visibleWalls(state, seat).map((w) => w.r * 1000 + w.c * 10 + (w.orientation === 'h' ? 1 : 2)),
  );
}