/**
 * Brand identity — the single swap point for the final name.
 *
 * Provisional wordmark: NEXUS + wall-notch glyph (two pawn squares cut by
 * crossing walls). Final legal/registrar-cleared name replaces APP_NAME only;
 * every component reads from here. Domain status: UNVERIFIED (see
 * docs/branding/BRAND_CANDIDATES.md) — no availability is claimed.
 */
export const BRAND = {
  APP_NAME: 'PROJECT_NEXUS',
  APP_SHORT_NAME: 'NEXUS',
  APP_DESCRIPTION: 'Move or build a wall. Outmaneuver your rival in the original wall-and-pawn strategy arena.',
  TAGLINE: 'Build your path. Block theirs.',
  PROVISIONAL: true,
} as const;

/** Wall-notch glyph geometry (32×32 viewBox), shared by logo + favicon. */
export const GLYPH = {
  viewBox: '0 0 32 32',
  pawns: [
    { x: 4, y: 4, fill: 'var(--player-a)' },
    { x: 18, y: 18, fill: 'var(--player-b)' },
  ],
  walls: [
    { x: 14, y: 6, w: 12, h: 4 },
    { x: 6, y: 14, w: 4, h: 12 },
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
