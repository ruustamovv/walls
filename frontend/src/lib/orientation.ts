/**
 * Board orientation: the main player is ALWAYS at the bottom of the board.
 *
 * The engine renders row 0 at the top of the screen. In 2P, seat 0 starts
 * on row 0 (top) and seat 1 on the last row (bottom), so seat 0 needs a
 * 180° visual rotation to sit at the bottom. Rotation is purely visual
 * (CSS transform on the board wrapper) — engine coordinates, legality and
 * interaction mapping are untouched.
 */
import type { CSSProperties } from 'react';

export function duelBottomSeat(mySeat: 0 | 1 | null, flipped: boolean): 0 | 1 {
  if (mySeat === null) return flipped ? 1 : 0;
  return (flipped ? 1 - mySeat : mySeat) as 0 | 1;
}

/** True when the 2P board wrapper must be rotated 180° to bottom the user. */
export function duelRotated(mySeat: 0 | 1 | null, flipped: boolean): boolean {
  if (mySeat === null) return flipped;
  return mySeat === 0 !== flipped;
}

export type SeatSide = 'N' | 'S' | 'E' | 'W';

/**
 * Visual rotation (degrees) that puts the given side's starting zone at
 * the bottom of the screen. Starts: S top-center, N bottom-center,
 * E middle-left, W middle-right.
 */
export function multiRotationDeg(side: SeatSide | string, flipped: boolean): number {
  const base = side === 'S' ? 180 : side === 'E' ? -90 : side === 'W' ? 90 : 0;
  return base + (flipped ? 180 : 0);
}

/** CSS transform for a board wrapper given a rotation in degrees. */
export function rotationStyle(deg: number): CSSProperties {
  return deg === 0 ? {} : { transform: `rotate(${deg}deg)` };
}
