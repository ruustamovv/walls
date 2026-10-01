/**
 * J3 — auth + guest + ops journey: credential lifecycle, guest fencing and
 * conversion, server clock ticks, admin RBAC, tournaments, puzzles, and the
 * honest unconfigured-coach response.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot, shutdown, call, register, type World } from '../support/boot.js';

let w: World;

before(async () => {
  w = await boot('e2e_ops');
});

after(async () => {
  await shutdown(w);
});

describe('journey: auth lifecycle', () => {
  it('register, duplicate rejection, logout, login, password rotation, logout-all', async () => {
    const init = await call(w.app, 'POST', '/api/v1/auth/register', '', {
      email: 'opslifecycle@example.com',
      username: 'ops_life',
      password: 's3cret-pass',
    });
    assert.equal(init.status, 200);
    let cookie = init.cookie;
    assert.ok(cookie !== '');

    const dup = await call(w.app, 'POST', '/api/v1/auth/register', '', {
      email: 'opslifecycle@example.com',
      username: 'ops_other',
      password: 's3cret-pass',
    });
    assert.ok(dup.status >= 400);

    const badLogin = await call(w.app, 'POST', '/api/v1/auth/login', '', { login: 'ops_life', password: 'wrong-pass' });
    assert.ok(badLogin.status >= 400);

    assert.equal((await call(w.app, 'POST', '/api/v1/auth/logout', cookie)).status, 200);
    assert.equal((await call(w.app, 'GET', '/api/v1/auth/me', cookie)).status, 401);

    const login = await call(w.app, 'POST', '/api/v1/auth/login', '', { login: 'ops_life', password: 's3cret-pass' });
    assert.equal(login.status, 200);
    cookie = login.cookie;

    const rot = await call(w.app, 'POST', '/api/v1/auth/password', cookie, { current: 's3cret-pass', next: 'n3w-secret-pass' });
    assert.equal(rot.status, 200);
    assert.ok((await call(w.app, 'POST', '/api/v1/auth/login', '', { login: 'ops_life', password: 's3cret-pass' })).status >= 400);
    const login2 = await call(w.app, 'POST', '/api/v1/auth/login', '', { login: 'ops_life', password: 'n3w-secret-pass' });
    assert.equal(login2.status, 200);

    assert.equal((await call(w.app, 'POST', '/api/v1/auth/logout-all', login2.cookie)).status, 200);
    assert.equal((await call(w.app, 'GET', '/api/v1/auth/me', cookie)).status, 401);
    assert.equal((await call(w.app, 'GET', '/api/v1/auth/me', login2.cookie)).status, 401);
  });
});

describe('journey: guests, clocks, admin, tournaments, puzzles', () => {
  it('guests fence ranked play and convert cleanly', async () => {
    const g = await call(w.app, 'POST', '/api/v1/auth/guest', '', {});
    assert.equal(g.status, 200);
    assert.equal((g.json['user'] as Record<string, unknown>)['guest'], true);
    const cookie = g.cookie;

    assert.ok((await call(w.app, 'POST', '/api/v1/matchmaking/join', cookie, { mode: 'ranked', timeControl: '3+1' })).status >= 400);
    const q = await call(w.app, 'POST', '/api/v1/matchmaking/join', cookie, { mode: 'casual', timeControl: '3+0' });
    assert.equal(q.status, 200);

    const conv = await call(w.app, 'POST', '/api/v1/auth/convert', cookie, {
      email: 'opsconverted@example.com',
      username: 'ops_converted',
      password: 's3cret-pass',
    });
    assert.equal(conv.status, 200);
    assert.equal((conv.json['user'] as Record<string, unknown>)['guest'], false);
    const ranked = await call(w.app, 'POST', '/api/v1/matchmaking/join', conv.cookie, { mode: 'ranked', timeControl: '3+1' });
    assert.equal(ranked.status, 200);
  });

  it('server clock ticks without client input', async () => {    const a = await register(w.app, 'ops_clock_a');
    const b = await register(w.app, 'ops_clock_b');
    const created = await call(w.app, 'POST', '/api/v1/games', a.cookie, { timeControl: '3+0', opponentId: b.id });
    const gameId = String(created.json['id']);
    const s1 = await call(w.app, 'GET', `/api/v1/games/${gameId}`, a.cookie);
    await new Promise((r) => setTimeout(r, 1200));
    const s2 = await call(w.app, 'GET', `/api/v1/games/${gameId}`, a.cookie);
    const c1 = (s1.json['clockMs'] as number[])[0] ?? 0;
    const c2 = (s2.json['clockMs'] as number[])[0] ?? 0;
    assert.ok(c2 < c1, `clock should tick down (${c1} -> ${c2})`);
  });

  it('admin surface is staff-only; tournaments and puzzles work', async () => {
    const u = await register(w.app, 'ops_plain');
    assert.equal((await call(w.app, 'GET', '/api/v1/admin/overview', u.cookie)).status, 403);

    const t = await call(w.app, 'POST', '/api/v1/tournaments', u.cookie, { title: 'E2E Cup', format: 'single-elim' });
    assert.equal(t.status, 200);
    const tid = String((t.json['tournament'] as Record<string, unknown>)['_id'] ?? (t.json['tournament'] as Record<string, unknown>)['id']);
    const v = await register(w.app, 'ops_second');
    assert.equal((await call(w.app, 'POST', `/api/v1/tournaments/${tid}/join`, v.cookie)).status, 200);
    assert.equal((await call(w.app, 'POST', `/api/v1/tournaments/${tid}/open`, u.cookie)).status, 200);
    const detail = await call(w.app, 'GET', `/api/v1/tournaments/${tid}`, u.cookie);
    assert.equal(detail.status, 200);

    const daily = await call(w.app, 'GET', '/api/v1/puzzles/daily', u.cookie);
    assert.equal(daily.status, 200);
    assert.ok(typeof daily.json['puzzleId'] === 'string');
    const badAttempt = await call(w.app, 'POST', '/api/v1/puzzles/daily/attempt', u.cookie, { wall: { r: -5, c: 99, orientation: 'z' } });
    assert.ok(badAttempt.status >= 400);

    const coach = await call(w.app, 'POST', '/api/v1/ai/coach', u.cookie, {
      moveNumber: 3,
      playedAction: 'wall h 2,2',
      bestAction: 'wall h 3,3',
      ownPathBefore: 9,
      ownPathAfter: 10,
      oppPathBefore: 9,
      oppPathAfter: 13,
    });
    assert.equal(coach.status, 200);
    assert.equal(coach.json['available'], false);
  });

  it('email verification issues and confirms a token; classic rates its own pool; xp derives from activity', async () => {
    const u = await register(w.app, 'ops_verify');
    const me0 = await call(w.app, 'GET', '/api/v1/auth/me', u.cookie);
    assert.equal((me0.json['user'] as Record<string, unknown>)['emailVerified'], false);

    // Bad token rejected.
    assert.ok((await call(w.app, 'POST', '/api/v1/auth/verify/confirm', u.cookie, { token: 'nope' })).status >= 400);

    // Mint a real token straight from the store, then confirm it.
    const { getMongoDb } = await import('../../../backend/dist/database/mongodb/client.js');
    const { requestVerification } = await import('../../../backend/dist/modules/auth/verify.js');
    await requestVerification(u.id);
    const db = await getMongoDb();
    const { COLLECTIONS } = await import('../../../backend/dist/database/mongodb/collections.js');
    const rows = await db.collection(COLLECTIONS.email_verifications).find({ userId: u.id }).toArray();
    assert.ok(rows.length >= 1);

    // Positive path with a known token inserted directly (hash is one-way).
    const { createHash } = await import('node:crypto');
    await db.collection(COLLECTIONS.email_verifications).insertOne({
      tokenHash: createHash('sha256').update('e2e-verify-token').digest('hex'),
      userId: u.id,
      expiresAt: new Date(Date.now() + 3600000),
      createdAt: new Date(),
    });
    assert.equal((await call(w.app, 'POST', '/api/v1/auth/verify/confirm', u.cookie, { token: 'e2e-verify-token' })).status, 200);
    const me1 = await call(w.app, 'GET', '/api/v1/auth/me', u.cookie);
    assert.equal((me1.json['user'] as Record<string, unknown>)['emailVerified'], true);

    // Classic pool: 10+0 settles classic, visible in profile + history.
    const v = await register(w.app, 'ops_classic_opp');
    const g = await call(w.app, 'POST', '/api/v1/games', u.cookie, { timeControl: '10+0', opponentId: v.id });
    assert.equal(g.status, 200);
    const gid = String(g.body['id']);
    await call(w.app, 'POST', `/api/v1/games/${gid}/resign`, v.cookie);
    const prof = await call(w.app, 'GET', '/api/v1/profiles/ops_verify', u.cookie);
    const modes = ((prof.body['ratings'] as { mode: string; games: number }[]) ?? []).map((r) => r.mode);
    assert.ok(modes.includes('classic'));
    const hist = await call(w.app, 'GET', '/api/v1/profiles/ops_verify/ratings/classic/history', u.cookie);
    assert.ok(((hist.body['points'] as unknown[])?.length ?? 0) >= 1);

    // XP derives from the finished game above.
    const xp = await call(w.app, 'GET', '/api/v1/profiles/ops_verify/xp', u.cookie);
    assert.equal(xp.status, 200);
    assert.ok((xp.body['xp'] as number) >= 10);
    assert.ok((xp.body['level'] as number) >= 1);
    assert.ok(((xp.body['breakdown'] as Record<string, number>)['finishedGames'] ?? 0) >= 1);
  });

  it('party puzzle serves without leaking the solution and grades attempts', async () => {
    const u = await register(w.app, 'ops_party');
    const daily = await call(w.app, 'GET', '/api/v1/puzzles/multi/daily', u.cookie);
    assert.equal(daily.status, 200);
    assert.ok(typeof daily.body['puzzleId'] === 'string');
    assert.ok(!('solution' in (daily.body as Record<string, unknown>)));
    const bad = await call(w.app, 'POST', '/api/v1/puzzles/multi/attempt', u.cookie, { wall: { r: 0, c: 0, orientation: 'x' } });
    assert.ok(bad.status >= 400);
    // Far-corner wall: legal but gains nothing on the leader.
    const size = daily.body['size'] as number;
    const weak = await call(w.app, 'POST', '/api/v1/puzzles/multi/attempt', u.cookie, {
      wall: { r: size - 2, c: size - 2, orientation: 'h' },
    });
    assert.equal(weak.status, 200);
    assert.equal(weak.body['solved'], false);
  });
});
