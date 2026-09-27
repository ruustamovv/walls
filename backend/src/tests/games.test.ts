/** Games service: legal move applies, illegal move rejected, turn enforced. */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { GamesService } from '../modules/games/service.js';
import { getLegalMoves, createGame } from '../../../engine/typescript/dist/index.js';

describe('games service', () => {
  it('creates a game with engine state', () => {
    const svc = new GamesService();
    const g = svc.create({ creatorId: 'u1', opponentId: 'u2' });
    assert.equal(g.state.pawns.length, 2);
    assert.equal(g.status, 'active');
  });

  it('applies a legal pawn move', () => {
    const svc = new GamesService();
    const g = svc.create({ creatorId: 'u1', opponentId: 'u2' });
    const legal = getLegalMoves(g.state, 0);
    assert.ok(legal.length > 0);
    const dest = legal[0] as { r: number; c: number };
    const next = svc.play(g.id, 'u1', { type: 'move', to: { r: dest.r, c: dest.c } });
    assert.equal(next.state.moveNumber, 1);
    assert.equal(next.state.turn, 1);
  });

  it('rejects an illegal move (out of bounds / non-adjacent)', () => {
    const svc = new GamesService();
    const g = svc.create({ creatorId: 'u1', opponentId: 'u2' });
    // Pick a destination far from pawn 0 that cannot be legal on move 0.
    const fresh = createGame({ size: 9, wallsPerPlayer: 10 });
    const legal = new Set(getLegalMoves(fresh, 0).map((p) => `${p.r},${p.c}`));
    let illegal = { r: 0, c: 0 };
    outer: for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        if (!legal.has(`${r},${c}`)) {
          illegal = { r, c };
          break outer;
        }
      }
    }
    assert.throws(() => svc.play(g.id, 'u1', { type: 'move', to: illegal }));
  });

  it('enforces turn order', () => {
    const svc = new GamesService();
    const g = svc.create({ creatorId: 'u1', opponentId: 'u2' });
    const legal = getLegalMoves(g.state, 0);
    const dest = legal[0] as { r: number; c: number };
    // u2 tries to move on u1's turn.
    assert.throws(() => svc.play(g.id, 'u2', { type: 'move', to: { r: dest.r, c: dest.c } }));
  });

  it('records action history and resign awards the opponent', () => {
    const svc = new GamesService();
    const g = svc.create({ creatorId: 'u1', opponentId: 'u2' });
    const legal = getLegalMoves(g.state, 0);
    const dest = legal[0] as { r: number; c: number };
    svc.play(g.id, 'u1', { type: 'move', to: { r: dest.r, c: dest.c } });
    assert.equal(g.actions.length, 1);
    const done = svc.resign(g.id, 'u2');
    assert.equal(done.status, 'finished');
    assert.equal(done.winnerSeat, 0);
    assert.equal(done.finishReason, 'resign');
    assert.throws(() => svc.resign(g.id, 'u1'));
  });

  it('draw offers end the game by agreement when accepted', () => {
    const svc = new GamesService();
    const g = svc.create({ creatorId: 'u1', opponentId: 'u2' });
    svc.offerDraw(g.id, 'u1');
    assert.equal(g.drawOfferBy, 0);
    assert.throws(() => svc.respondDraw(g.id, 'u1', true)); // cannot answer own offer
    const done = svc.respondDraw(g.id, 'u2', true);
    assert.equal(done.status, 'finished');
    assert.equal(done.winnerSeat, null);
    assert.equal(done.finishReason, 'draw');
  });

  it('declined draws clear the offer and play continues', () => {
    const svc = new GamesService();
    const g = svc.create({ creatorId: 'u1', opponentId: 'u2' });
    svc.offerDraw(g.id, 'u2');
    svc.respondDraw(g.id, 'u1', false);
    assert.equal(g.drawOfferBy, null);
    assert.equal(g.status, 'active');
  });

  it('timeout flags the player to move and awards the other seat', () => {
    const svc = new GamesService();
    const g = svc.create({ creatorId: 'u1', opponentId: 'u2', timeControl: '1+0' });
    g.clock.remainingMs[0] = 1;
    g.clock.lastTickAt = Date.now() - 5000;
    svc.tickClock(g, Date.now());
    assert.equal(g.status, 'finished');
    assert.equal(g.winnerSeat, 1);
    assert.equal(g.finishReason, 'timeout');
  });
});
