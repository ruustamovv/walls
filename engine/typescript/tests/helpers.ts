/** Shared test helpers: deterministic state construction. */
import { RULES_VERSION, type GameState, type PlayerIndex, type Pos, type Wall } from '../index.js';

export interface StateOverrides {
  pawns?: [Pos, Pos];
  walls?: Wall[];
  wallsRemaining?: [number, number];
  turn?: PlayerIndex;
  wallsPerPlayer?: number;
  isOver?: boolean;
  winner?: null | PlayerIndex;
  moveNumber?: number;
  seed?: number;
}

export function makeState(size: number, o: StateOverrides = {}): GameState {
  const mid = Math.floor(size / 2);
  const walls = o.wallsPerPlayer ?? 10;
  const state: GameState = {
    size,
    wallsPerPlayer: walls,
    turn: o.turn ?? 0,
    pawns: o.pawns ?? [
      { r: 0, c: mid },
      { r: size - 1, c: mid },
    ],
    walls: (o.walls ?? []).map((w) => ({ ...w })),
    wallsRemaining: o.wallsRemaining ?? [walls, walls],
    winner: o.winner ?? null,
    isOver: o.isOver ?? false,
    moveNumber: o.moveNumber ?? 0,
    lastAction: null,
    rulesVersion: RULES_VERSION,
  };
  if (o.seed !== undefined) state.seed = o.seed;
  return state;
}

export function wall(r: number, c: number, orientation: 'h' | 'v'): Wall {
  return { r, c, orientation };
}

export function pos(r: number, c: number): Pos {
  return { r, c };
}

/** Assert two position arrays contain the same set (order-insensitive). */
export function samePosSet(a: Pos[], b: Pos[]): boolean {
  if (a.length !== b.length) return false;
  const key = (p: Pos): string => `${p.r},${p.c}`;
  const sa = new Set(a.map(key));
  return b.every((p) => sa.has(key(p)));
}
