/**
 * Brand identity — Quoridor (quoridor.uz).
 * Single swap point for name/domain.
 */
export const BRAND = {
  APP_NAME: 'Quoridor',
  APP_SHORT_NAME: 'Quoridor',
  APP_DESCRIPTION: 'Outmaneuver your rival in the wall-and-pawn arena.',
  TAGLINE: 'Build walls. Find path.',
  PROVISIONAL: false,
  DOMAIN: 'quoridor.uz',
} as const;

/** Quoridor grid glyph (32×32): 3x3 cells + wall + pawn. */
export const GLYPH = {
  viewBox: '0 0 32 32',
  pawns: [
    { x: 5, y: 5, fill: 'var(--player-a)' },
    { x: 19, y: 19, fill: 'var(--player-b)' },
  ],
  walls: [
    { x: 14, y: 4, w: 13, h: 4.5 },
    { x: 4, y: 14, w: 4.5, h: 13 },
  ],
} as const;

/** Rating divisions — thresholds are display-only, never skill claims. */
export const DIVISIONS = [
  { min: 0, name: 'Drifter', color: '#8a93a0' },
  { min: 1000, name: 'Pathfinder', color: '#1a56db' },
  { min: 1300, name: 'Wallwright', color: '#0e9f6e' },
  { min: 1600, name: 'Routemaster', color: '#c2410c' },
  { min: 1900, name: 'Arenarch', color: '#7c3aed' },
  { min: 2200, name: 'Grand Nexus', color: '#b45309' },
] as const;

export function divisionFor(rating: number): (typeof DIVISIONS)[number] {
  let current = DIVISIONS[0] as (typeof DIVISIONS)[number];
  for (const d of DIVISIONS) {
    if (rating >= d.min) current = d;
  }
  return current;
}
