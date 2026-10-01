/** Socket tickets: single-use, expiring, bound to one user + authed route. */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { issueSocketTicket, redeemSocketTicket, __resetSocketTicketsForTests } from '../realtime/tickets.js';
import { buildApp } from '../app.js';

describe('socket tickets', () => {
  it('issues single-use tickets bound to one user', () => {
    __resetSocketTicketsForTests();
    const a = issueSocketTicket('u1');
    assert.ok(a.ticket.length >= 32);
    assert.equal(redeemSocketTicket(a.ticket), 'u1');
    // Second redemption fails (single-use).
    assert.equal(redeemSocketTicket(a.ticket), null);
    // Garbage fails.
    assert.equal(redeemSocketTicket('nope'), null);
    assert.equal(redeemSocketTicket(null), null);
  });

  it('tickets expire', () => {
    __resetSocketTicketsForTests();
    const now = Date.now();
    const { ticket } = issueSocketTicket('u2', now);
    assert.equal(redeemSocketTicket(ticket, now + 61_000), null);
    const fresh = issueSocketTicket('u2', now);
    assert.equal(redeemSocketTicket(fresh.ticket, now + 1000), 'u2');
  });

  it('POST /socket/ticket needs a session', async () => {
    const app = await buildApp();
    try {
      const anon = await app.inject({ method: 'POST', url: '/api/v1/socket/ticket' });
      assert.equal(anon.statusCode, 401);
      const reg = await app.inject({
        method: 'POST', url: '/api/v1/auth/register',
        payload: JSON.stringify({ email: 'sockt@example.com', username: 'socktick', password: 's3cret-pass' }),
        headers: { 'content-type': 'application/json' },
      });
      assert.equal(reg.statusCode, 200);
      const setCookie = reg.headers['set-cookie'];
      const cookie = (Array.isArray(setCookie) ? setCookie[0] : setCookie ?? '').split(';')[0] ?? '';
      const authed = await app.inject({ method: 'POST', url: '/api/v1/socket/ticket', headers: { cookie } });
      assert.equal(authed.statusCode, 200);
      const body = authed.json() as { ticket: string; expiresInSec: number };
      assert.ok(body.ticket.length >= 32);
      assert.ok(body.expiresInSec > 0);
    } finally {
      await app.close().catch(() => undefined);
    }
  });
});
