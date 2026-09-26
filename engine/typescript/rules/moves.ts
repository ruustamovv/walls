/**
 * Pawn move generation, classic wall-and-pawn jumping rules:
 * - Orthogonal single steps into free, unblocked cells.
 * - Straight jump over an adjacent opponent when the landing cell beyond
 *   is on-board and unblocked.
 * - Diagonal sidesteps from the opponent's cell when the straight landing
 *   is off-board or blocked by a wall (only in that case).
 * - No other diagonal moves exist.
 */
import { isBlockedBetween, isInBoundsCell } from '../core/board.js';
import type { GameState, PlayerIndex, Pos } from '../core/types.js';

const DIRS: readonly Pos[] = [
  { r: -1, c: 0 },
  { r: 1, c: 0 },
  { r: 0, c: -1 },
  { r: 0, c: 1 },
];

/** All legal destination cells for `player`'s pawn in `state`. */
export function getLegalMoves(state: GameState, player: PlayerIndex): Pos[] {
  const me = state.pawns[player] as Pos;
  const opp = state.pawns[(1 - player) as PlayerIndex] as Pos;
  const { size, walls } = state;

  const out: Pos[] = [];
  const seen = new Set<string>();
  const push = (p: Pos): void => {
    const key = `${p.r},${p.c}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push({ r: p.r, c: p.c });
    }
  };

  for (const d of DIRS) {
    const adj: Pos = { r: me.r + d.r, c: me.c + d.c };
    if (!isInBoundsCell(adj, size) || isBlockedBetween(me, adj, walls)) continue;

    const isOpponent = adj.r === opp.r && adj.c === opp.c;
    if (!isOpponent) {
      push(adj);
      continue;
    }

    // Opponent adjacent: attempt the straight jump first.
    const beyond: Pos = { r: opp.r + d.r, c: opp.c + d.c };
    if (isInBoundsCell(beyond, size) && !isBlockedBetween(opp, beyond, walls)) {
      push(beyond);
      continue;
    }

    // Straight landing unavailable -> diagonal sidesteps around the opponent.
    const perpendiculars: readonly Pos[] =
      d.r !== 0 ? [{ r: 0, c: -1 }, { r: 0, c: 1 }] : [{ r: -1, c: 0 }, { r: 1, c: 0 }];
    for (const p of perpendiculars) {
      const diag: Pos = { r: opp.r + p.r, c: opp.c + p.c };
      if (isInBoundsCell(diag, size) && !isBlockedBetween(opp, diag, walls)) {
        push(diag);
      }
    }
  }

  return out;
}
