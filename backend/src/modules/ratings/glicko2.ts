/**
 * Glicko-2 rating system (original implementation following Glickman's spec).
 *
 * Scale: rating ~ N(1500, 350^2) initially, volatility 0.06.
 * Ratings are tracked PER MODE (blitz/rapid/...) — callers keep one
 * GlickoRating per (player, mode).
 *
 * Reference: "The Glicko-2 system" — http://www.glicko.net/glicko/glicko2.pdf
 * This file implements the paper's Steps 1–8 without external deps.
 */

export interface GlickoRating {
  rating: number;
  rd: number;
  vol: number;
}

export interface GlickoOpponent {
  rating: number;
  rd: number;
  /** 1 = win, 0.5 = draw, 0 = loss (from the player's perspective). */
  score: number;
}

export const GLICKO_DEFAULT_RATING = 1500;
export const GLICKO_DEFAULT_RD = 350;
export const GLICKO_DEFAULT_VOL = 0.06;
export const GLICKO_TAU = 0.5;
export const GLICKO_EPSILON = 0.000001;

const SCALE = 173.7178;

export function defaultRating(): GlickoRating {
  return { rating: GLICKO_DEFAULT_RATING, rd: GLICKO_DEFAULT_RD, vol: GLICKO_DEFAULT_VOL };
}

export function isProvisional(r: GlickoRating): boolean {
  // Provisional until deviation tightens below the starting value.
  return r.rd >= GLICKO_DEFAULT_RD;
}

function g(phi: number): number {
  return 1 / Math.sqrt(1 + (3 * phi * phi) / (Math.PI * Math.PI));
}

function E(mu: number, muj: number, phij: number): number {
  return 1 / (1 + Math.exp(-g(phij) * (mu - muj)));
}

function validateRating(r: GlickoRating, label: string): void {
  if (!Number.isFinite(r.rating) || !Number.isFinite(r.rd) || !Number.isFinite(r.vol)) {
    throw new Error(`Invalid Glicko rating (${label}): non-finite values`);
  }
  if (r.rd <= 0) throw new Error(`Invalid Glicko rating (${label}): rd must be > 0`);
  if (r.vol <= 0) throw new Error(`Invalid Glicko rating (${label}): vol must be > 0`);
}

/**
 * Update a player's rating from a set of period results.
 * Pure — inputs are never mutated. Empty results = inactivity (RD grows).
 */
export function updateRatings(
  player: GlickoRating,
  opponents: readonly GlickoOpponent[],
  tau: number = GLICKO_TAU,
): GlickoRating {
  validateRating(player, 'player');
  for (const o of opponents) {
    if (!Number.isFinite(o.rating) || !Number.isFinite(o.rd)) {
      throw new Error('Invalid Glicko opponent: non-finite values');
    }
    if (o.rd <= 0) throw new Error('Invalid Glicko opponent: rd must be > 0');
    if (o.score !== 0 && o.score !== 0.5 && o.score !== 1) {
      throw new Error('Invalid Glicko opponent: score must be 0, 0.5 or 1');
    }
  }

  const mu = (player.rating - GLICKO_DEFAULT_RATING) / SCALE;
  const phi = player.rd / SCALE;
  const sigma = player.vol;

  if (opponents.length === 0) {
    // Step 8 (no games): RD widens, rating/vol unchanged.
    const phiStar = Math.sqrt(phi * phi + sigma * sigma);
    return { rating: player.rating, rd: phiStar * SCALE, vol: sigma };
  }

  // Step 2: convert opponents to Glicko-2 scale.
  const mus = opponents.map((o) => (o.rating - GLICKO_DEFAULT_RATING) / SCALE);
  const phis = opponents.map((o) => o.rd / SCALE);

  // Steps 3–4: estimated variance v and improvement delta.
  let vInv = 0;
  let deltaSum = 0;
  for (let i = 0; i < opponents.length; i++) {
    const muj = mus[i] as number;
    const phij = phis[i] as number;
    const score = opponents[i]?.score ?? 0;
    const gij = g(phij);
    const eij = E(mu, muj, phij);
    vInv += gij * gij * eij * (1 - eij);
    deltaSum += gij * (score - eij);
  }
  const v = 1 / vInv;
  const delta = v * deltaSum;

  // Step 5: new volatility via Illinois-style iteration.
  const a = Math.log(sigma * sigma);
  const f = (x: number): number => {
    const ex = Math.exp(x);
    const num = ex * (delta * delta - phi * phi - v - ex);
    const den = 2 * Math.pow(phi * phi + v + ex, 2);
    return num / den - (x - a) / (tau * tau);
  };
  let A = a;
  let B: number;
  if (delta * delta > phi * phi + v) {
    B = Math.log(delta * delta - phi * phi - v);
  } else {
    let k = 1;
    while (f(a - k * tau) < 0) k += 1;
    B = a - k * tau;
  }
  let fA = f(A);
  let fB = f(B);
  while (Math.abs(B - A) > GLICKO_EPSILON) {
    const C = A + ((A - B) * fA) / (fB - fA);
    const fC = f(C);
    if (fC * fB <= 0) {
      A = B;
      fA = fB;
    } else {
      fA = fA / 2;
    }
    B = C;
    fB = fC;
  }
  const sigmaPrime = Math.exp(A / 2);

  // Steps 6–8.
  const phiStar = Math.sqrt(phi * phi + sigmaPrime * sigmaPrime);
  const phiPrime = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v);
  let muSum = 0;
  for (let i = 0; i < opponents.length; i++) {
    const muj = mus[i] as number;
    const phij = phis[i] as number;
    const score = opponents[i]?.score ?? 0;
    muSum += g(phij) * (score - E(mu, muj, phij));
  }
  const muPrime = mu + phiPrime * phiPrime * muSum;

  return {
    rating: GLICKO_DEFAULT_RATING + SCALE * muPrime,
    rd: phiPrime * SCALE,
    vol: sigmaPrime,
  };
}

/** Convenience: expected score of A vs B (single game, no update). */
export function expectedScore(a: GlickoRating, b: GlickoRating): number {
  validateRating(a, 'a');
  validateRating(b, 'b');
  const mu = (a.rating - GLICKO_DEFAULT_RATING) / SCALE;
  const muj = (b.rating - GLICKO_DEFAULT_RATING) / SCALE;
  const phij = b.rd / SCALE;
  return E(mu, muj, phij);
}
