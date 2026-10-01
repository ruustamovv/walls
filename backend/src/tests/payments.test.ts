/**
 * Payments (PRM-003): webhook signature verification, idempotent grant,
 * honest disabled state. Stripe network never touched (HMAC only).
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { MongoMemoryServer } from 'mongodb-memory-server';
import {
  verifyStripeWebhook,
  applyStripeEvent,
  paymentStatus,
  createCheckoutSession,
} from '../modules/payments/provider.js';
import { getMongoDb, closeMongo, __resetMongoForTests } from '../database/mongodb/client.js';
import { EntitlementRepository } from '../database/mongodb/repositories/premium.repository.js';

const SECRET = 'whsec_test_secret_1234567890';

function sign(payload: string, t: number): string {
  const v1 = createHmac('sha256', SECRET).update(`${t}.${payload}`, 'utf8').digest('hex');
  return `t=${t},v1=${v1}`;
}

function eventPayload(userId: string, eventId = 'evt_test_1'): string {
  return JSON.stringify({
    id: eventId,
    type: 'checkout.session.completed',
    data: { object: { id: 'cs_test', customer: 'cus_test', client_reference_id: userId, metadata: { userId } } },
  });
}

describe('stripe webhook verification', () => {
  it('accepts a fresh valid signature and rejects the rest', () => {
    const now = Date.now();
    const payload = eventPayload('u1');
    const t = Math.floor(now / 1000);
    const good = verifyStripeWebhook(payload, sign(payload, t), SECRET, now);
    assert.ok(good !== null);
    assert.equal(good.type, 'checkout.session.completed');
    assert.equal(good.userId, 'u1');
    assert.equal(verifyStripeWebhook(payload + 'x', sign(payload, t), SECRET, now), null);
    assert.equal(verifyStripeWebhook(payload, 't=1,v1=deadbeef', SECRET, now), null);
    assert.equal(verifyStripeWebhook(payload, sign(payload, t), 'wrong-secret', now), null);
    // Stale timestamp rejected.
    assert.equal(verifyStripeWebhook(payload, sign(payload, t - 600), SECRET, now), null);
    // Malformed JSON rejected.
    assert.equal(verifyStripeWebhook('{{{', sign('{{{', t), SECRET, now), null);
  });

  it('disabled state is honest without keys', () => {
    const status = paymentStatus();
    assert.equal(status.provider, 'none');
    assert.equal(status.checkoutReady, false);
  });

  it('checkout throws when unconfigured', async () => {
    await assert.rejects(() => createCheckoutSession('u1'), /no payment provider|unavailable/);
  });
});

describe('stripe event application', () => {
  let mongod: MongoMemoryServer | null = null;

  before(async () => {
    mongod = await MongoMemoryServer.create({ instance: { dbName: 'nexus_pay' } });
    process.env['MONGODB_URI'] = mongod.getUri();
    process.env['MONGODB_DB_NAME'] = 'nexus_pay';
    __resetMongoForTests();
  });

  after(async () => {
    await closeMongo().catch(() => undefined);
    __resetMongoForTests();
    if (mongod !== null) await mongod.stop().catch(() => undefined);
    mongod = null;
  });

  it('grants the bundle once and ignores replays + other event types', async () => {
    const now = Date.now();
    const payload = eventPayload('pay_user_1');
    const verified = verifyStripeWebhook(payload, sign(payload, Math.floor(now / 1000)), SECRET, now);
    assert.ok(verified !== null);
    assert.equal(await applyStripeEvent(verified), true);
    const db = await getMongoDb();
    const ents = await new EntitlementRepository(db).list('pay_user_1');
    assert.ok(ents.length >= 5);
    // Replay of the same event id grants nothing new.
    assert.equal(await applyStripeEvent(verified), false);
    // Non-completion events never grant.
    const other = { ...verified, id: 'evt_other', type: 'invoice.paid' };
    assert.equal(await applyStripeEvent(other), false);
  });

  it('webhook route verifies raw bytes and grants via HTTP', async () => {
    const { buildApp } = await import('../app.js');
    const { __resetAuthServiceForTests } = await import('../modules/auth/service.js');
    __resetAuthServiceForTests();
    const app = await buildApp();
    try {
    const now = Date.now();
    const payload = eventPayload('pay_user_2', 'evt_test_http_1');
    const sig = sign(payload, Math.floor(now / 1000));
      const bad = await app.inject({
        method: 'POST',
        url: '/api/v1/payments/webhook',
        payload,
        headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=nope' },
      });
      assert.equal(bad.statusCode, 400);
      // Unsigned without a configured secret also fails closed.
      const goodUnsigned = await app.inject({
        method: 'POST',
        url: '/api/v1/payments/webhook',
        payload,
        headers: { 'content-type': 'application/json', 'stripe-signature': sig },
      });
      assert.equal(goodUnsigned.statusCode, 400);
      // With the secret configured, a signed event grants the bundle.
      process.env['STRIPE_WEBHOOK_SECRET'] = SECRET;
      try {
        const good = await app.inject({
          method: 'POST',
          url: '/api/v1/payments/webhook',
          payload,
          headers: { 'content-type': 'application/json', 'stripe-signature': sig },
        });
        assert.equal(good.statusCode, 200);
        const db = await getMongoDb();
        const ents = await new EntitlementRepository(db).list('pay_user_2');
        assert.ok(ents.length >= 5);
      } finally {
        delete process.env['STRIPE_WEBHOOK_SECRET'];
      }
    } finally {
      await app.close().catch(() => undefined);
    }
  });
});
