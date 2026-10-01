/**
 * J1 — full ranked journey: register x2 -> matchmake -> sockets play a real
 * game to the goal -> ratings move -> replay + review + leaderboard +
 * profiles observe it -> reconnect resyncs -> chat works.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { getLegalMoves } from '../../../engine/typescript/dist/index.js';
import { boot, shutdown, call, register, connectSocket, waitFor, type World } from '../support/boot.js';

let w: World;

before(async () => {
  w = await boot('e2e_ranked');
});

after(async () => {
  await shutdown(w);
});

describe('journey: ranked 3+1 to the goal', () => {
  it('pairs, plays, settles, and publishes everywhere', async () => {
    const a = await register(w.app, 'journey_a');
    const b = await register(w.app, 'journey_b');

    const qa = await call(w.app, 'POST', '/api/v1/matchmaking/join', a.cookie, { mode: 'ranked', timeControl: '3+1' });
    assert.equal(qa.status, 200);
    const qb = await call(w.app, 'POST', '/api/v1/matchmaking/join', b.cookie, { mode: 'ranked', timeControl: '3+1' });
    assert.equal(qb.body['status'], 'matched');
    const gameId = String(qb.body['gameId']);
    const sta = await call(w.app, 'GET', '/api/v1/matchmaking/status', a.cookie);
    assert.equal(sta.body['gameId'], gameId);

    // Drive both pawns straight to the goal over REST (seat 0 down, seat 1 up).
    let turn: 0 | 1 = 0;
    let guard = 0;
    let winner: number | null = null;
    for (;;) {
      const g = await call(w.app, 'GET', `/api/v1/games/${gameId}`, a.cookie);
      const snap = g.body as unknown as {
        status: string; state: { turn: 0 | 1; pawns: { r: number; c: number }[]; size: number };
        winnerSeat: number | null;
      };
      if (snap.status === 'finished') {
        winner = snap.winnerSeat;
        break;
      }
      assert.ok(guard++ < 200, 'game did not finish');
      turn = snap.state.turn;
      const pawn = snap.state.pawns[turn] as { r: number; c: number };
      const legal = getLegalMoves(
        snap.state as unknown as Parameters<typeof getLegalMoves>[0],
        turn,
      );
      const fwd = legal.filter((m) => (turn === 0 ? m.r > pawn.r : m.r < pawn.r));
      const pick = (fwd[0] ?? legal[0]) as { r: number; c: number };
      const mover = turn === 0 ? a : b;
      const mv = await call(w.app, 'POST', `/api/v1/games/${gameId}/move`, mover.cookie, {
        type: 'move',
        to: { r: pick.r, c: pick.c },
      });
      assert.equal(mv.status, 200);
    }
    assert.ok(winner === 0 || winner === 1);

    // Ratings moved in opposite directions (provisional Glicko).
    const ha = await call(w.app, 'GET', '/api/v1/profiles/journey_a/ratings/blitz/history', a.cookie);
    const hb = await call(w.app, 'GET', '/api/v1/profiles/journey_b/ratings/blitz/history', b.cookie);
    const pa = (ha.json['points'] as { before: number; after: number }[]).at(-1);
    const pb = (hb.json['points'] as { before: number; after: number }[]).at(-1);
    assert.ok(pa !== undefined && pb !== undefined);
    assert.notEqual(pa.after, pa.before);
    assert.equal(Math.sign(pa.after - pa.before), -Math.sign(pb.after - pb.before));

    // Replay + review + leaderboard + profiles observe the finished game.
    const replay = await call(w.app, 'GET', `/api/v1/replays/${gameId}`, a.cookie);
    assert.equal(replay.status, 200);
    assert.ok(((replay.json['actions'] as unknown[])?.length ?? 0) > 10);
    const review = await call(w.app, 'GET', `/api/v1/games/${gameId}/review`, a.cookie);
    assert.ok(((review.json['moves'] as unknown[])?.length ?? 0) > 10);
    const lb = await call(w.app, 'GET', '/api/v1/leaderboard?mode=blitz', a.cookie);
    const names = ((lb.json['entries'] as { username: string }[]) ?? []).map((e) => e.username);
    assert.ok(names.includes('journey_a') && names.includes('journey_b'));
    const prof = await call(w.app, 'GET', '/api/v1/profiles/journey_a', a.cookie);
    assert.ok(((prof.json['recentGames'] as unknown[])?.length ?? 0) >= 1);
  });

  it('reconnect resyncs and table talk works over sockets', async () => {
    const a = await register(w.app, 'journey_c');
    const b = await register(w.app, 'journey_d');
    const created = await call(w.app, 'POST', '/api/v1/games', a.cookie, { timeControl: '3+0', opponentId: b.id });
    const gameId = String((created.json as Record<string, unknown>)['id']);

    const sockA = await connectSocket(w.base, a.id);
    try {
      sockA.emit('game:join', { gameId });
      const first = await waitFor(sockA, 'game:state', (s) => String(s['id']) === gameId);
      assert.equal(first['status'], 'active');
      sockA.disconnect();

      const sockA2 = await connectSocket(w.base, a.id);
      try {
        sockA2.emit('game:join', { gameId });
        const second = await waitFor(sockA2, 'game:state', (s) => String(s['id']) === gameId);
        assert.equal(second['moveCount'], first['moveCount']);
        assert.equal(second['turn'], first['turn']);
      } finally {
        sockA2.disconnect();
      }
    } finally {
      if (sockA.connected) sockA.disconnect();
    }

    // Table talk: B joins and hears A (ranked games use quick-chat presets).
    const sockB = await connectSocket(w.base, b.id);
    try {
      sockB.emit('game:join', { gameId });
      await waitFor(sockB, 'game:state', (s) => String(s['id']) === gameId);
      const heard = waitFor(sockB, 'game:chat', (m) => String(m['body']) === 'Good luck');
      const sockA3 = await connectSocket(w.base, a.id);
      try {
        sockA3.emit('game:join', { gameId });
        await waitFor(sockA3, 'game:state', (s) => String(s['id']) === gameId);
        sockA3.emit('game:chat', { gameId, body: 'Good luck' });
        const msg = await heard;
        assert.equal(String(msg['from']), a.id);
      } finally {
        sockA3.disconnect();
      }
    } finally {
      sockB.disconnect();
    }
  });
});
