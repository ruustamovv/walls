/** Auth: hashing round-trip + register/login/logout flow. */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword } from '../modules/auth/hashing.js';
import { AuthService } from '../modules/auth/service.js';

describe('auth hashing', () => {
  it('round-trips a password', async () => {
    const h = await hashPassword('correct-horse-123');
    assert.equal(await verifyPassword(h, 'correct-horse-123'), true);
    assert.equal(await verifyPassword(h, 'wrong-password'), false);
  });
});

describe('auth service', () => {
  it('register -> login -> logout', async () => {
    const svc = new AuthService();
    const reg = await svc.register({ email: 'a@example.com', username: 'alice', password: 's3cret-pass' });
    assert.equal(reg.user.username, 'alice');

    const login = await svc.login({ login: 'alice', password: 's3cret-pass' });
    assert.equal(login.user.id, reg.user.id);

    const me = await svc.me(login.session.id);
    assert.ok(me !== null);

    await svc.logout(login.session.id);
    assert.equal(await svc.me(login.session.id), null);
  });

  it('rejects duplicate email and bad password', async () => {
    const svc = new AuthService();
    await svc.register({ email: 'b@example.com', username: 'bob', password: 's3cret-pass' });
    await assert.rejects(() => svc.register({ email: 'b@example.com', username: 'bobby', password: 's3cret-pass' }));
    await assert.rejects(() => svc.login({ login: 'bob', password: 'nope-nope-nope' }));
  });
});
