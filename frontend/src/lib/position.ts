/**
 * Portable positions: base64 JSON in links (?from= / #hash).
 * Decoded states are shape-checked; anything malformed returns null.
 */
import type { GameState, Pos, Wall } from '../../../engine/typescript/core/types.js';

export function encodePosition(s: GameState): string {
  const slim = {
    size: s.size, wallsPerPlayer: s.wallsPerPlayer, turn: s.turn,
    pawns: s.pawns, walls: s.walls, wallsRemaining: s.wallsRemaining,
  };
  return btoa(unescape(encodeURIComponent(JSON.stringify(slim))));
}

export function decodePosition(code: string): { state: GameState; actions: [] } | null {
  try {
    const raw = JSON.parse(decodeURIComponent(escape(atob(code)))) as {
      size: number; wallsPerPlayer: number; turn: 0 | 1;
      pawns: [Pos, Pos]; walls: Wall[]; wallsRemaining: [number, number];
    };
    if (!Number.isInteger(raw.size) || raw.size < 5 || raw.size > 19) return null;
    if (!Array.isArray(raw.pawns) || raw.pawns.length !== 2) return null;
    for (const p of raw.pawns) {
      if (!Number.isInteger(p.r) || !Number.isInteger(p.c) || p.r < 0 || p.c < 0 || p.r >= raw.size || p.c >= raw.size) return null;
    }
    if (!Array.isArray(raw.walls)) return null;
    const walls: Wall[] = [];
    for (const w of raw.walls) {
      if ((w.orientation === 'h' || w.orientation === 'v') && Number.isInteger(w.r) && Number.isInteger(w.c)
        && w.r >= 0 && w.c >= 0 && w.r <= raw.size - 2 && w.c <= raw.size - 2) {
        walls.push({ r: w.r, c: w.c, orientation: w.orientation });
      }
    }
    return {
      actions: [],
      state: {
        size: raw.size,
        wallsPerPlayer: Math.min(30, Math.max(0, raw.wallsPerPlayer ?? 10)),
        turn: raw.turn === 1 ? 1 : 0,
        pawns: [{ ...raw.pawns[0] }, { ...raw.pawns[1] }],
        walls,
        wallsRemaining: Array.isArray(raw.wallsRemaining) ? [...raw.wallsRemaining as [number, number]] : [10, 10],
        winner: null,
        isOver: false,
        moveNumber: 0,
        lastAction: null,
        rulesVersion: '1.0.0',
      },
    };
  } catch {
    return null;
  }
}
