/**
 * Cosmetics catalog (COS-001): profile frames. No gameplay effect, ever.
 *
 * Free frames are owned by everyone. Premium frames require the
 * PREMIUM_COSMETICS entitlement (admin grant or Stripe bundle) — checked
 * server-side on equip, never trusted from the client.
 */
export interface Cosmetic {
  id: string;
  kind: 'frame';
  name: string;
  /** CSS ring rendered around the avatar. */
  ring: string;
  premium: boolean;
}

export const COSMETICS: Cosmetic[] = [
  { id: 'frame-none', kind: 'frame', name: 'Classic', ring: 'inset 0 0 0 2px rgba(255,255,255,.25)', premium: false },
  { id: 'frame-bronze', kind: 'frame', name: 'Bronze', ring: 'inset 0 0 0 2px #b45309, 0 0 10px rgba(180,83,9,.45)', premium: false },
  { id: 'frame-silver', kind: 'frame', name: 'Silver', ring: 'inset 0 0 0 2px #9aa4b5, 0 0 10px rgba(154,164,180,.45)', premium: false },
  { id: 'frame-gold', kind: 'frame', name: 'Gold', ring: 'inset 0 0 0 2px #d97706, 0 0 14px rgba(217,119,6,.55)', premium: true },
  { id: 'frame-diamond', kind: 'frame', name: 'Diamond', ring: 'inset 0 0 0 2px #38bdf8, 0 0 14px rgba(56,189,248,.55)', premium: true },
  { id: 'frame-apex', kind: 'frame', name: 'Apex', ring: 'inset 0 0 0 2px #a78bfa, 0 0 16px rgba(167,139,250,.65)', premium: true },
];

export function cosmeticById(id: string): Cosmetic | null {
  return COSMETICS.find((c) => c.id === id) ?? null;
}
