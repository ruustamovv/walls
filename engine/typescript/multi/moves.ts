/**
 * N-player pawn moves: orthogonal steps, straight jumps over ANY adjacent
 * pawn (landing must be free of ALL pawns), diagonal sidesteps only when
 * the straight landing is off-board or walled.
 */
import { isBlockedBetween, isInBoundsCell } from '../core/board.js';
import type { MultiPos, MultiState } from './types.js';

const DIRS: readonly MultiPos[] = [
  { r: -1, c: 0 },
  { r: 1, c: 0 },
  { r: 0, c: -1 },
  { r: 0, c: 1 },
];

function occupiedBy(pawns: readonly MultiPos[], p: MultiPos, except: number): number {
  for (let i = 0; i < pawns.length; i++) {
    if (i === except) continue;
    const q = pawns[i] as MultiPos;
    if (q.r === p.r && q.c === p.c) return i;
  }
  return -1;
}

export function getMultiLegalMoves(state: MultiState, player: number): MultiPos[] {
  const me = state.pawns[player] as MultiPos;
  const { size, walls, pawns } = state;
  const out: MultiPos[] = [];
  const seen = new Set<string>();
  const push = (p: MultiPos): void => {
    const key = `${p.r},${p.c}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push({ r: p.r, c: p.c });
    }
  };

  for (const d of DIRS) {
    const adj: MultiPos = { r: me.r + d.r, c: me.c + d.c };
    if (!isInBoundsCell(adj, size) || isBlockedBetween(me, adj, walls)) continue;
    const foe = occupiedBy(pawns, adj, player);
    if (foe === -1) {
      push(adj);
      continue;
    }
    const foePos = pawns[foe] as MultiPos;
    const beyond: MultiPos = { r: foePos.r + d.r, c: foePos.c + d.c };
    if (
      isInBoundsCell(beyond, size) &&
      !isBlockedBetween(foePos, beyond, walls) &&
      occupiedBy(pawns, beyond, player) === -1
    ) {
      push(beyond);
      continue;
    }
    const perpendiculars: readonly MultiPos[] =
      d.r !== 0 ? [{ r: 0, c: -1 }, { r: 0, c: 1 }] : [{ r: -1, c: 0 }, { r: 1, c: 0 }];
    for (const p of perpendiculars) {
      const diag: MultiPos = { r: foePos.r + p.r, c: foePos.c + p.c };
      if (
        isInBoundsCell(diag, size) &&
        !isBlockedBetween(foePos, diag, walls) &&
        occupiedBy(pawns, diag, player) === -1
      ) {
        push(diag);
      }
    }
  }
  return out;
}
