/**
 * J2 — social journey: friend request -> accept -> challenge notification ->
 * accept into a ranked game -> club found/join -> club chat round-trip ->
 * block enforcement.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot, shutdown, call, register, connectSocket, waitFor, type World } from '../support/boot.js';

let w: World;

before(async () => {
  w = await boot('e2e_social');
});

after(async () => {
  await shutdown(w);
});

describe('journey: friends, challenges, clubs', () => {
  it('friends, challenges into a game, clubs, and blocks', async () => {
    const a = await register(w.app, 'social_a');
    const b = await register(w.app, 'social_b');

    // Friend request lifecycle.
    const req = await call(w.app, 'POST', '/api/v1/friends/request', a.cookie, { username: 'social_b' });
    assert.equal(req.status, 200);
    const incoming = await call(w.app, 'GET', '/api/v1/friends/requests', b.cookie);
    const items = incoming.json['requests'] as { id: string; from: string }[];
    assert.ok(items.length >= 1);
    const acc = await call(w.app, 'POST', '/api/v1/friends/accept', b.cookie, { requestId: items[0]?.id });
    assert.equal(acc.status, 200);
    const listA = await call(w.app, 'GET', '/api/v1/friends', a.cookie);
    assert.ok(((listA.json['friends'] as unknown[])?.length ?? 0) >= 1);

    // Challenge -> notification -> accept creates a ranked game.
    const ch = await call(w.app, 'POST', '/api/v1/challenges', a.cookie, { username: 'social_b', timeControl: '3+1', mode: 'ranked' });
    assert.equal(ch.status, 200);
    const inbox = await call(w.app, 'GET', '/api/v1/notifications', b.cookie);
    const notes = inbox.json['notifications'] as { kind: string; body?: string }[];
    const invite = notes.find((n) => n.kind === 'challenge');
    assert.ok(invite?.body !== undefined);
    const payload = JSON.parse(invite.body as string) as { from: string; timeControl: string };
    const g = await call(w.app, 'POST', '/api/v1/games', b.cookie, { timeControl: payload.timeControl, opponentId: payload.from });
    assert.equal(g.status, 200);
    assert.equal(g.json['status'], 'active');
    assert.equal(g.json['mode'], 'ranked');

    // Clubs: found, join, chat round-trip over sockets.
    const club = await call(w.app, 'POST', '/api/v1/clubs', a.cookie, { name: 'E2E Club', description: 'journey' });
    assert.equal(club.status, 200);
    const clubId = String((club.json['club'] as Record<string, unknown>)['_id'] ?? (club.json['club'] as Record<string, unknown>)['id']);
    const join = await call(w.app, 'POST', `/api/v1/clubs/${clubId}/join`, b.cookie);
    assert.equal(join.status, 200);
    const sockB = await connectSocket(w.base, b.id);
    try {
      sockB.emit('club:join', { clubId });
      await waitFor(sockB, 'club:history', (m) => String(m['clubId']) === clubId);
      const heard = waitFor(sockB, 'club:chat', (m) => String(m['body']) === 'hello club');
      const sockA = await connectSocket(w.base, a.id);
      try {
        sockA.emit('club:join', { clubId });
        await waitFor(sockA, 'club:history', (m) => String(m['clubId']) === clubId);
        sockA.emit('club:chat', { clubId, body: 'hello club' });
        await heard;
      } finally {
        sockA.disconnect();
      }
      const hist = await call(w.app, 'GET', `/api/v1/clubs/${clubId}/chat`, a.cookie);
      assert.ok(((hist.json['messages'] as unknown[])?.length ?? 0) >= 1);
    } finally {
      sockB.disconnect();
    }

    // Block enforcement: a fresh request from the blocked side fails.
    const c = await register(w.app, 'social_c');
    const blk = await call(w.app, 'POST', '/api/v1/friends/block', a.cookie, { username: 'social_c' });
    assert.equal(blk.status, 200);
    const reqAfter = await call(w.app, 'POST', '/api/v1/friends/request', c.cookie, { username: 'social_a' });
    assert.ok(reqAfter.status >= 400);
  });
});
