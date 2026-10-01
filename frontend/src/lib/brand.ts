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

/** Rating divisions — spec tiers, display-only, never skill claims. */
export const DIVISIONS = [
  { min: 0, name: 'Novice', color: '#8a93a0' },
  { min: 700, name: 'Rookie', color: '#7c8a9c' },
  { min: 900, name: 'Bronze', color: '#b45309' },
  { min: 1100, name: 'Silver', color: '#6b7280' },
  { min: 1300, name: 'Gold', color: '#d97706' },
  { min: 1500, name: 'Platinum', color: '#64748b' },
  { min: 1700, name: 'Diamond', color: '#2563eb' },
  { min: 1900, name: 'Master', color: '#7c3aed' },
  { min: 2100, name: 'Grandmaster', color: '#c2410c' },
  { min: 2300, name: 'Elite', color: '#0e9f6e' },
  { min: 2500, name: 'Legend', color: '#b45309' },
  { min: 2800, name: 'Apex', color: '#111827' },
] as const;

export function divisionFor(rating: number): (typeof DIVISIONS)[number] {
  let current = DIVISIONS[0] as (typeof DIVISIONS)[number];
  for (const d of DIVISIONS) {
    if (rating >= d.min) current = d;
  }
  return current;
}
