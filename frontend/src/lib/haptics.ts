/**
 * Haptics: light vibration on supported mobile devices, graceful no-op
 * elsewhere. Never vibrate without a user-visible game event.
 */
export function buzz(pattern: number | number[]): void {
  try {
    const nav = navigator as Navigator & { vibrate?: (p: number | number[]) => boolean };
    if (typeof nav.vibrate === 'function') nav.vibrate(pattern);
  } catch {
    // unsupported — silent
  }
}

export const haptic = {
  move: () => buzz(12),
  wall: () => buzz([15, 30, 15]),
  error: () => buzz([40, 40, 40]),
  victory: () => buzz([25, 50, 25, 50, 60]),
};
