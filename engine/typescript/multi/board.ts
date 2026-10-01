/**
 * Multiplayer geometry: starts, goals, BFS to a goal SIDE.
 * Wall blocking reuses the proven 2P core (player-count agnostic).
 */
import { getNeighbors, isBlockedBetween, isInBoundsCell } from '../core/board.js';
import type { MultiPos, MultiState, SeatSide } from './types.js';

export function defaultSides(players: number): SeatSide[] {
  if (players === 2) return ['S', 'N'];
  if (players === 3) return ['S', 'E', 'W'];
  if (players === 5) return ['S', 'N', 'E', 'W', 'S'];
  if (players === 6) return ['S', 'N', 'E', 'W', 'S', 'N'];
  return ['S', 'N', 'E', 'W'];
}

/**
 * Start cell for a side. `occurrence` handles shared edges (5P doubles S):
 * first pawn takes mid-lane, later ones offset by ±2 lanes (clamped
 * inside). Goals are full edges, so shared-edge racers stay fair.
 */
export function startFor(side: SeatSide, size: number, occurrence = 0): MultiPos {
  const mid = Math.floor(size / 2);
  const lane = Math.min(size - 2, Math.max(1, mid + laneOffset(occurrence)));
  if (side === 'S') return { r: 0, c: lane };
  if (side === 'N') return { r: size - 1, c: lane };
  if (side === 'E') return { r: lane, c: 0 };
  return { r: lane, c: size - 1 };
}

function laneOffset(occurrence: number): number {
  if (occurrence <= 0) return 0;
  const step = Math.ceil(occurrence / 2) * 2;
  return occurrence % 2 === 1 ? -step : step;
}

export function isGoal(side: SeatSide, size: number, p: MultiPos): boolean {
  if (side === 'S') return p.r === size - 1;
  if (side === 'N') return p.r === 0;
  if (side === 'E') return p.c === size - 1;
  return p.c === 0;
}

export interface SidePath {
  length: number;
  path: MultiPos[];
}

/** BFS from a pawn to the nearest cell on its goal side. */
export function shortestToSide(walls: MultiState['walls'], size: number, from: MultiPos, side: SeatSide): SidePath {
  if (isGoal(side, size, from)) return { length: 0, path: [{ ...from }] };
  const prev: number[][] = Array.from({ length: size }, () => new Array<number>(size).fill(-1));
  const queue: MultiPos[] = [{ ...from }];
  prev[from.r]![from.c] = from.r * size + from.c;
  let head = 0;
  let found: MultiPos | null = null;
  while (head < queue.length) {
    const cur = queue[head++] as MultiPos;
    for (const next of getNeighbors(cur, walls as { r: number; c: number; orientation: 'h' | 'v' }[], size)) {
      if (prev[next.r]?.[next.c] !== -1) continue;
      prev[next.r]![next.c] = cur.r * size + cur.c;
      if (isGoal(side, size, next)) {
        found = next;
        head = queue.length;
        break;
      }
      queue.push(next);
    }
  }
  if (found === null) return { length: -1, path: [] };
  const path: MultiPos[] = [];
  let key = found.r * size + found.c;
  for (;;) {
    const r = Math.floor(key / size);
    const c = key % size;
    path.push({ r, c });
    const p = prev[r]?.[c] as number;
    if (p === key) break;
    key = p;
  }
  path.reverse();
  return { length: path.length - 1, path };
}

export function hasSidePath(state: MultiState, player: number): boolean {
  const pawn = state.pawns[player];
  if (pawn === undefined) return false;
  const side = state.sides[player];
  if (side === undefined) return false;
  return shortestToSide(state.walls, state.size, pawn, side).length >= 0;
}

export { isBlockedBetween, isInBoundsCell };
export type { MultiPos };
