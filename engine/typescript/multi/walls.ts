/**
 * N-player wall legality: geometry + inventory + EVERY pawn keeps a route.
 */
import { canPlaceWallGeometry } from '../core/board.js';
import { hasSidePath } from './board.js';
import type { MultiState, MultiValidation, MultiWall } from './types.js';

const ORIENTATIONS = ['h', 'v'] as const;

export function validateMultiWall(state: MultiState, player: number, wall: MultiWall): MultiValidation {
  if (state.isOver) return { ok: false, reason: 'game_over' };
  const geometry = canPlaceWallGeometry(state.walls, wall, state.size);
  if (!geometry.ok) {
    const reason = geometry.reason as MultiValidation['reason'];
    if (reason !== undefined) return { ok: false, reason };
    return { ok: false, reason: 'invalid_orientation' };
  }
  if ((state.wallsRemaining[player] ?? 0) <= 0) {
    return { ok: false, reason: 'no_walls_remaining' };
  }
  const probe: MultiState = { ...state, walls: [...state.walls, { ...wall }] };
  for (let p = 0; p < state.players; p++) {
    if (!hasSidePath(probe, p)) return { ok: false, reason: 'blocks_path' };
  }
  return { ok: true };
}

/** Every legal wall for `player`, deterministic (r, c, orientation) order. */
export function getMultiLegalWalls(state: MultiState, player: number): MultiWall[] {
  if (state.isOver) return [];
  if ((state.wallsRemaining[player] ?? 0) <= 0) return [];
  const out: MultiWall[] = [];
  const max = state.size - 2;
  for (let r = 0; r <= max; r++) {
    for (let c = 0; c <= max; c++) {
      for (const orientation of ORIENTATIONS) {
        const wall: MultiWall = { r, c, orientation };
        if (!canPlaceWallGeometry(state.walls, wall, state.size).ok) continue;
        const probe: MultiState = { ...state, walls: [...state.walls, wall] };
        let ok = true;
        for (let p = 0; p < state.players; p++) {
          if (!hasSidePath(probe, p)) {
            ok = false;
            break;
          }
        }
        if (ok) out.push(wall);
      }
    }
  }
  return out;
}
