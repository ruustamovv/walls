/**
 * Payment provider abstraction (PRM-003).
 *
 * Only Stripe exists as an optional provider, and only when fully
 * configured. No keys → honest disabled state everywhere (no fake
 * checkout UI: the frontend renders the disabled reason verbatim).
 *
 * Webhook verification is dependency-free HMAC-SHA256 per Stripe's
 * `t=...,v1=...` scheme (300s tolerance). The ONLY server-authoritative
 * mutation is entitlement grants — never trust client claims.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { getMongoDb } from '../../database/mongodb/client.js';
import { COLLECTIONS } from '../../database/mongodb/collections.js';
import { EntitlementRepository, ENTITLEMENTS, type Entitlement } from '../../database/mongodb/repositories/premium.repository.js';
import { logger } from '../../common/logging/logger.js';

export type PaymentProviderId = 'none' | 'stripe';

function env(name: string): string {
  const v = process.env[name] ?? '';
  return v.includes('PASTE_YOUR') ? '' : v.trim();
}

export function paymentProvider(): PaymentProviderId {
  if ((process.env['PAYMENT_PROVIDER'] ?? 'none').trim().toLowerCase() !== 'stripe') return 'none';
  return env('STRIPE_SECRET_KEY') !== '' ? 'stripe' : 'none';
}

/** What the premium UI is allowed to offer. */
export function paymentStatus(): { provider: PaymentProviderId; checkoutReady: boolean; reason: string } {
  const selected = (process.env['PAYMENT_PROVIDER'] ?? 'none').trim().toLowerCase();
  if (selected !== 'stripe') {
    return { provider: 'none', checkoutReady: false, reason: 'no payment provider configured — entitlements are granted by admins/promos only' };
  }
  if (env('STRIPE_SECRET_KEY') === '') {
    return { provider: 'none', checkoutReady: false, reason: 'stripe selected but STRIPE_SECRET_KEY is missing' };
  }
  return { provider: 'stripe', checkoutReady: true, reason: 'stripe checkout live' };
}

export interface CheckoutSession {
  id: string;
  url: string | null;
}

/** Create a Stripe Checkout Session (subscription) via the REST API. */
export async function createCheckoutSession(userId: string): Promise<CheckoutSession> {
  const key = env('STRIPE_SECRET_KEY');
  if (paymentProvider() !== 'stripe' || key === '') {
    throw new Error('checkout unavailable — no payment provider configured');
  }
  const price = env('STRIPE_PRICE_ID');
  if (price === '') throw new Error('checkout unavailable — STRIPE_PRICE_ID is missing');
  const frontend = (process.env['FRONTEND_URL'] ?? 'http://localhost:5173').replace(/\/$/, '');
  const params = new URLSearchParams({
    'payment_method_types[0]': 'card',
    mode: 'subscription',
    'line_items[0][price]': price,
    'line_items[0][quantity]': '1',
    success_url: `${frontend}/premium?checkout=success`,
    cancel_url: `${frontend}/premium?checkout=cancelled`,
    client_reference_id: userId,
    'metadata[userId]': userId,
  });
  const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  if (!res.ok) {
    logger.warn({ status: res.status }, 'stripe checkout session failed');
    throw new Error('checkout provider errored — try again later');
  }
  const body = (await res.json().catch(() => ({}))) as { id?: string; url?: string | null };
  if (typeof body.id !== 'string') throw new Error('checkout provider returned an unreadable session');
  return { id: body.id, url: body.url ?? null };
}

export interface VerifiedStripeEvent {
  id: string;
  type: string;
  userId: string | null;
  customer: string | null;
}

/**
 * Verify a Stripe webhook signature and extract routing fields.
 * Returns null on ANY failure (bad signature, stale timestamp, bad JSON).
 */
export function verifyStripeWebhook(
  rawBody: string,
  signature: string,
  secret: string,
  now: number = Date.now(),
): VerifiedStripeEvent | null {
  try {
    const parts = Object.fromEntries(
      signature.split(',').map((p) => {
        const i = p.indexOf('=');
        return i === -1 ? ['', ''] : [p.slice(0, i), p.slice(i + 1)];
      }),
    );
    const t = Number(parts['t'] ?? '');
    const v1 = parts['v1'] ?? '';
    if (!Number.isFinite(t) || v1 === '' || secret === '') return null;
    if (Math.abs(now / 1000 - t) > 300) return null;
    const expected = createHmac('sha256', secret).update(`${t}.${rawBody}`, 'utf8').digest('hex');
    const a = Buffer.from(v1, 'utf8');
    const b = Buffer.from(expected, 'utf8');
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    const event = JSON.parse(rawBody) as { id?: string; type?: string; data?: { object?: Record<string, unknown> } };
    if (typeof event.id !== 'string' || typeof event.type !== 'string') return null;
    const obj = event.data?.object ?? {};
    const meta = obj['metadata'] as Record<string, unknown> | undefined;
    const userId = typeof obj['client_reference_id'] === 'string'
      ? (obj['client_reference_id'] as string)
      : typeof meta?.['userId'] === 'string'
        ? (meta['userId'] as string)
        : null;
    return {
      id: event.id,
      type: event.type,
      userId,
      customer: typeof obj['customer'] === 'string' ? (obj['customer'] as string) : null,
    };
  } catch {
    return null;
  }
}

const PREMIUM_BUNDLE: Entitlement[] = [...ENTITLEMENTS];

/**
 * Apply a verified Stripe event. Idempotent per event id (dedupe table);
 * only checkout.session.completed grants. Returns true when entitlements
 * were newly granted.
 */
export async function applyStripeEvent(event: VerifiedStripeEvent): Promise<boolean> {
  if (event.type !== 'checkout.session.completed') return false;
  if (event.userId === null) {
    logger.warn({ eventId: event.id }, 'stripe event without userId — ignored');
    return false;
  }
  let db;
  try {
    db = await getMongoDb();
  } catch {
    return false;
  }
  const seen = await db.collection(COLLECTIONS.stripe_events).findOne({ eventId: event.id }).catch(() => null);
  if (seen !== null) return false;
  const repo = new EntitlementRepository(db);
  for (const e of PREMIUM_BUNDLE) {
    await repo.grant(event.userId, e, 'stripe').catch(() => undefined);
  }
  await db.collection(COLLECTIONS.stripe_events).insertOne({
    eventId: event.id, userId: event.userId, type: event.type, createdAt: new Date(),
  }).catch(() => undefined);
  logger.info({ eventId: event.id, userId: event.userId }, 'premium bundle granted via stripe');
  return true;
}
