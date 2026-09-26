/**
 * Breadth-first shortest-path search over pawn moves (walls respected).
 * Pawn jumps are NOT modelled here: pathfinding measures wall-constrained
 * distance to the goal row for route-existence checks, which is the
 * conservative quantity the wall-placement rule needs.
 */
import { getNeighbors, goalRowFor } from '../core/board.js';
import type { GameState, PlayerIndex, Pos } from '../core/types.js';

export interface ShortestPath {
  /** Number of steps from pawn to goal row; -1 when unreachable. */
  length: number;
  /** Cells from pawn (inclusive) to a goal cell (inclusive); [] if unreachable. */
  path: Pos[];
}

export interface PathMetrics {
  pathLengthA: number;
  pathLengthB: number;
  /** pathLengthA - pathLengthB (informational; -1 marks unreachable legs). */
  delta: number;
  reachableA: boolean;
  reachableB: boolean;
}

/**
 * BFS from the player's pawn to the nearest goal-row cell.
 * Deterministic: neighbours expand in fixed order (up, down, left, right),
 * so ties resolve identically on every run.
 */
export function findShortestPath(state: GameState, player: PlayerIndex): ShortestPath {
  const { size, walls } = state;
  const start = state.pawns[player];
  const goal = goalRowFor(player, size);

  if (start.r === goal) return { length: 0, path: [{ ...start }] };

  // prev[r][c] stores the encoded predecessor key, -1 = unvisited.
  const prev: number[][] = Array.from({ length: size }, () => new Array<number>(size).fill(-1));
  const queue: Pos[] = [{ ...start }];
  prev[start.r][start.c] = start.r * size + start.c; // root points to itself
  let head = 0;
  let found: Pos | null = null;

  while (head < queue.length) {
    const cur = queue[head++] as Pos;
    for (const next of getNeighbors(cur, walls, size)) {
      if (prev[next.r]?.[next.c] !== -1) continue;
      prev[next.r]![next.c] = cur.r * size + cur.c;
      if (next.r === goal) {
        found = next;
        head = queue.length; // break outer loop
        break;
      }
      queue.push(next);
    }
  }

  if (found === null) return { length: -1, path: [] };

  // Reconstruct reversed chain back to the root.
  const path: Pos[] = [];
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

/** Shortest-path lengths and reachability for both players. */
export function getPathMetrics(state: GameState): PathMetrics {
  const a = findShortestPath(state, 0);
  const b = findShortestPath(state, 1);
  return {
    pathLengthA: a.length,
    pathLengthB: b.length,
    delta: a.length - b.length,
    reachableA: a.length >= 0,
    reachableB: b.length >= 0,
  };
}

/** True when the player's pawn can still reach its goal row. */
export function hasPathToGoal(state: GameState, player: PlayerIndex): boolean {
  return findShortestPath(state, player).length >= 0;
}
