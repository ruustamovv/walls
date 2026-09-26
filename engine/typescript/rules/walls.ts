/**
 * Wall legality: geometric validity (bounds / duplicate / crossing) PLUS
 * inventory availability PLUS the path-preservation rule — a placement is
 * legal only if BOTH players still reach their goal rows afterwards.
 */
import { canPlaceWallGeometry } from '../core/board.js';
import type { GameState, PlayerIndex, ValidationResult, Wall } from '../core/types.js';
import { hasPathToGoal } from '../pathfinding/bfs.js';

const ORIENTATIONS = ['h', 'v'] as const;

/** Validate a wall placement for `player` without mutating state. */
export function validateWall(
  state: GameState,
  player: PlayerIndex,
  wall: Wall,
): ValidationResult {
  if (state.isOver) return { ok: false, reason: 'game_over' };

  const geometry = canPlaceWallGeometry(state.walls, wall, state.size);
  if (!geometry.ok) return geometry;

  if (state.wallsRemaining[player] <= 0) {
    return { ok: false, reason: 'no_walls_remaining' };
  }

  // Path-preservation rule: simulate the placement and require a route
  // for both pawns. Shallow probe object avoids a full state clone.
  const probe: GameState = { ...state, walls: [...state.walls, { ...wall }] };
  if (!hasPathToGoal(probe, 0) || !hasPathToGoal(probe, 1)) {
    return { ok: false, reason: 'blocks_path' };
  }

  return { ok: true };
}

/**
 * Every wall placement that is geometrically valid AND preserves a route
 * for both players. Returns [] when the game is over or the player has no
 * walls left. Ordered deterministically by (r, c, orientation).
 */
export function getLegalWalls(state: GameState, player: PlayerIndex): Wall[] {
  if (state.isOver) return [];
  if (state.wallsRemaining[player] <= 0) return [];

  const out: Wall[] = [];
  const max = state.size - 2;
  for (let r = 0; r <= max; r++) {
    for (let c = 0; c <= max; c++) {
      for (const orientation of ORIENTATIONS) {
        const wall: Wall = { r, c, orientation };
        if (!canPlaceWallGeometry(state.walls, wall, state.size).ok) continue;
        const probe: GameState = { ...state, walls: [...state.walls, wall] };
        if (hasPathToGoal(probe, 0) && hasPathToGoal(probe, 1)) {
          out.push(wall);
        }
      }
    }
  }
  return out;
}
