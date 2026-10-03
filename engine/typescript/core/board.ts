/**
 * Board geometry helpers: bounds checks, wall occupancy, movement blocking.
 *
 * Wall semantics (fixed):
 * - An 'h' wall at (r, c) sits BETWEEN rows r and r+1 and spans columns
 *   c and c+1. It blocks vertical movement for both covered columns.
 * - A 'v' wall at (r, c) sits BETWEEN columns c and c+1 and spans rows
 *   r and r+1. It blocks horizontal movement for both covered rows.
 * - Wall slots live on a (size-1) x (size-1) grid: 0 <= r,c <= size-2.
 * - Overlap  = same slot + same orientation (duplicate, illegal).
 * - Crossing = same slot + opposite orientation (illegal).
 * - Collinear-adjacent walls (e.g. 'h' at (r,c) and (r,c+1)) are LEGAL and
 *   simply form longer barriers; the path-preservation rule still applies.
 */
import type { PlayerIndex, Pos, ValidationResult, Wall, WallShape } from './types.js';

/** Goal row for a player: P0 -> bottom row, P1 -> top row. */
export function goalRowFor(player: PlayerIndex, size: number): number {
  return player === 0 ? size - 1 : 0;
}

/** Start cell for a player: top/bottom row, middle column. */
export function startPosFor(player: PlayerIndex, size: number): Pos {
  const mid = Math.floor(size / 2);
  return player === 0 ? { r: 0, c: mid } : { r: size - 1, c: mid };
}

/** True when the value is an integer cell coordinate inside the board. */
export function isInBoundsCell(pos: Pos, size: number): boolean {
  return (
    Number.isInteger(pos.r) &&
    Number.isInteger(pos.c) &&
    pos.r >= 0 &&
    pos.c >= 0 &&
    pos.r < size &&
    pos.c < size
  );
}

/** True when the wall slot is inside the (size-1)x(size-1) wall grid
 *  and carries a valid orientation. */
export function isInBoundsWall(wall: Wall, size: number): boolean {
  return (
    (wall.orientation === 'h' || wall.orientation === 'v') &&
    Number.isInteger(wall.r) &&
    Number.isInteger(wall.c) &&
    wall.r >= 0 &&
    wall.c >= 0 &&
    wall.r <= size - 2 &&
    wall.c <= size - 2
  );
}

/** Structural equality of two wall placements. */
export function wallsEqual(a: Wall, b: Wall): boolean {
  return a.r === b.r && a.c === b.c && a.orientation === b.orientation;
}

/**
 * True when direct movement between two orthogonally adjacent cells is
 * blocked by a wall. Non-adjacent pairs are reported as blocked (there is
 * no single-step move between them anyway).
 */
export function isBlockedBetween(a: Pos, b: Pos, walls: readonly WallShape[]): boolean {
  const dr = b.r - a.r;
  const dc = b.c - a.c;
  if (Math.abs(dr) + Math.abs(dc) !== 1) return true;

  if (dr !== 0) {
    // Vertical step between rows minR and minR+1 in column a.c.
    // Blocked by an 'h' wall at (minR, a.c) [covers a.c, a.c+1] or at
    // (minR, a.c-1) [covers a.c-1, a.c].
    const minR = Math.min(a.r, b.r);
    const col = a.c;
    for (const w of walls) {
      if (w.orientation === 'h' && w.r === minR && (w.c === col || w.c === col - 1)) {
        return true;
      }
    }
    return false;
  }

  // Horizontal step between columns minC and minC+1 in row a.r.
  // Blocked by a 'v' wall at (a.r, minC) [covers a.r, a.r+1] or at
  // (a.r-1, minC) [covers a.r-1, a.r].
  const minC = Math.min(a.c, b.c);
  const row = a.r;
  for (const w of walls) {
    if (w.orientation === 'v' && w.c === minC && (w.r === row || w.r === row - 1)) {
      return true;
    }
  }
  return false;
}

/** Orthogonal neighbours of a cell reachable in one step (walls respected). */
export function getNeighbors(pos: Pos, walls: readonly WallShape[], size: number): Pos[] {
  const candidates: Pos[] = [
    { r: pos.r - 1, c: pos.c },
    { r: pos.r + 1, c: pos.c },
    { r: pos.r, c: pos.c - 1 },
    { r: pos.r, c: pos.c + 1 },
  ];
  return candidates.filter(
    (q) => isInBoundsCell(q, size) && !isBlockedBetween(pos, q, walls),
  );
}

/**
 * Pure geometry check for a wall placement: bounds, duplicate, crossing, and
 * collinear half-overlap.
 *
 * Collinear half-overlap matters because a wall piece is physically TWO cells
 * long: an 'h' wall at (r,c) covers columns c and c+1, so an 'h' wall at
 * (r,c+1) would sit half on top of it. The next free collinear slot is (r,c+2),
 * which butts cleanly end-to-end. Without this rule two sticks could be
 * stacked on the same segment — visually a double-thick, half-overlapping
 * barrier that no player placed that way.
 *
 * Does NOT check inventory or path preservation (see rules/walls.ts).
 */
export function canPlaceWallGeometry(
  walls: readonly WallShape[],
  wall: WallShape,
  size: number,
): ValidationResult {
  if (wall.orientation !== 'h' && wall.orientation !== 'v') {
    return { ok: false, reason: 'invalid_orientation' };
  }
  if (!isInBoundsWall(wall, size)) {
    return { ok: false, reason: 'out_of_bounds' };
  }
  for (const w of walls) {
    if (w.r === wall.r && w.c === wall.c) {
      if (w.orientation === wall.orientation) {
        return { ok: false, reason: 'duplicate_wall' };
      }
      return { ok: false, reason: 'crossing_wall' };
    }
    // Collinear neighbour sharing one cell: overlapping half-overlap.
    const sameRowH = wall.orientation === 'h' && w.orientation === 'h' && w.r === wall.r && Math.abs(w.c - wall.c) === 1;
    const sameColV = wall.orientation === 'v' && w.orientation === 'v' && w.c === wall.c && Math.abs(w.r - wall.r) === 1;
    if (sameRowH || sameColV) {
      return { ok: false, reason: 'overlapping_wall' };
    }
  }
  return { ok: true };
}
