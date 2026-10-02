/**
 * Socket.io realtime layer — rooms per gameId.
 *
 * Events (client -> server):
 *   game:join      { gameId }            — join room
 *   game:move      { gameId, to }        — MAKE_MOVE  (pawn)
 *   game:wall      { gameId, wall }      — PLACE_WALL (wall)
 *   game:reconnect { gameId }            — RECONNECT within grace window
 *
 * Events (server -> room):
 *   game:state  GAME_STATE snapshot
 *   game:error  { message }
 *
 * Auth: single-use socket tickets (realtime/tickets.js), issued over the
 * cookie-authenticated REST layer. Unsigned `auth.userId` is accepted in
 * dev/test only; production requires a ticket.
 */
import type { Server as HttpServer } from 'node:http';
import { Server, type Socket } from 'socket.io';
import { normalizeIntent } from '../../common/validation/schemas.js';
import { redeemSocketTicket } from '../tickets.js';
import { childLogger } from '../../common/logging/logger.js';
import { gamesService } from '../../modules/games/service.js';
import { multiGamesService } from '../../modules/multiGames/service.js';
import { emitMultiState, emitMultiStateTo } from './multi-fog.js';
import { settleFinishedGame } from '../../modules/games/finish.js';
import { settleMultiGame } from '../../modules/multiGames/finish.js';
import { persistGameFinished, persistMoveAppended } from '../../modules/games/persistence.js';
import { persistMultiMoveAppended } from '../../modules/multiGames/persistence.js';

interface JoinPayload {
  gameId: string;
}

interface AuthedSocket extends Socket {
  data: {
    userId?: string;
  };
}

function resolveUserId(socket: AuthedSocket): string | null {
  const auth = socket.handshake.auth as Record<string, unknown>;
  // Socket tickets (preferred): single-use, cookie-issued, 60s TTL.
  const redeemed = redeemSocketTicket(auth['ticket']);
  if (redeemed !== null) return redeemed;
  // Dev/test fallback: unsigned userId. Production requires a ticket.
  const candidate = auth['userId'];
  if (typeof candidate === 'string' && candidate.length > 0 && candidate.length <= 128) {
    if (process.env['NODE_ENV'] === 'production') return null;
    return candidate;
  }
  return null;
}

export function attachGameSocket(httpServer: HttpServer): Server {
  const frontend = process.env['FRONTEND_URL'] ?? 'http://localhost:5173';
  const io = new Server(httpServer, {
    cors: { origin: frontend, credentials: true },
    path: '/socket',
  });

  io.use((socket, next) => {
    const userId = resolveUserId(socket as AuthedSocket);
    if (userId === null) {
      next(new Error('unauthorized'));
      return;
    }
    (socket as AuthedSocket).data.userId = userId;
    next();
  });

  io.on('connection', (raw) => {
    const socket = raw as AuthedSocket;
    const userId = socket.data.userId ?? 'unknown';
    const log = childLogger({ userId });

    socket.on('game:join', (payload: unknown) => {
      try {
        const parsed = payload as Partial<JoinPayload>;
        if (typeof parsed.gameId !== 'string') {
          socket.emit('game:error', { message: 'gameId required' });
          return;
        }
        // Auto-seat spectators as viewers; players join seats via REST first.
        try {
          gamesService.join(parsed.gameId, userId);
        } catch {
          // join is best-effort here (game may already be full / spectator).
        }
        void socket.join(parsed.gameId);
        const g = gamesService.get(parsed.gameId);
        socket.emit('game:state', gamesService.snapshot(g));
      } catch (err) {
        const message = err instanceof Error ? err.message : 'join failed';
        socket.emit('game:error', { message });
      }
    });

    const handleAction = (payload: unknown): void => {
      const obj = (payload as Record<string, unknown>) ?? {};
      const gameId = obj['gameId'];
      const parsed = normalizeIntent(obj['action'] ?? obj);
      if (!parsed.success || typeof gameId !== 'string') {
        socket.emit('game:error', { message: 'invalid action payload' });
        return;
      }
      try {
        const g = gamesService.play(gameId, userId, parsed.data.action, {
          ...(typeof obj['actionId'] === 'string' ? { actionId: obj['actionId'] as string } : {}),
          ...(typeof obj['baseMoveNumber'] === 'number' ? { baseMoveNumber: obj['baseMoveNumber'] as number } : {}),
        });
        void persistMoveAppended(g).catch(() => undefined);
        if (g.status === 'finished' && !g.settled) {
          void settleFinishedGame(g)
            .then(() => persistGameFinished(g))
            .catch(() => undefined);
        }
        io.to(gameId).emit('game:state', gamesService.snapshot(g));
      } catch (err) {
        const message = err instanceof Error ? err.message : 'move rejected';
        log.info({ gameId, message }, 'action rejected');
        socket.emit('game:error', { message });
      }
    };

    socket.on('game:move', handleAction);
    socket.on('game:wall', handleAction);

    const settleAndBroadcast = (gameId: string): void => {
      try {
        const g = gamesService.get(gameId);
        if (g.status === 'finished' && !g.settled) {
          void settleFinishedGame(g)
            .then(() => persistGameFinished(g))
            .catch(() => undefined);
        }
        io.to(gameId).emit('game:state', gamesService.snapshot(g));
      } catch {
        // join-race: record vanished between calls
      }
    };

    socket.on('game:draw_offer', (payload: unknown) => {
      try {
        const gameId = (payload as Record<string, unknown>)?.['gameId'];
        if (typeof gameId !== 'string') {
          socket.emit('game:error', { message: 'gameId required' });
          return;
        }
        gamesService.offerDraw(gameId, userId);
        settleAndBroadcast(gameId);
      } catch (err) {
        socket.emit('game:error', { message: err instanceof Error ? err.message : 'draw offer failed' });
      }
    });

    socket.on('game:draw_response', (payload: unknown) => {
      try {
        const obj = (payload as Record<string, unknown>) ?? {};
        const gameId = obj['gameId'];
        const accept = obj['accept'];
        if (typeof gameId !== 'string' || typeof accept !== 'boolean') {
          socket.emit('game:error', { message: 'gameId + accept required' });
          return;
        }
        gamesService.respondDraw(gameId, userId, accept);
        settleAndBroadcast(gameId);
      } catch (err) {
        socket.emit('game:error', { message: err instanceof Error ? err.message : 'draw response failed' });
      }
    });

    // Live game chat: players only (spectators read), 1 message / 2s per
    // socket, 500 chars max. History is not persisted yet — moderation
    // hooks (report/block/mute) live on the REST layer.
    let lastChatAt = 0;
    socket.on('game:chat', (payload: unknown) => {
      void (async () => {
        try {
          const body = (payload as Record<string, unknown>)?.['body'];
          const gameId = (payload as Record<string, unknown>)?.['gameId'];
          if (typeof gameId !== 'string' || typeof body !== 'string') return;
          const text = body.trim().slice(0, 500);
          if (text.length === 0) return;
          const now = Date.now();
          if (now - lastChatAt < 2000) {
            socket.emit('game:error', { message: 'chatting too fast — slow down' });
            return;
          }
          lastChatAt = now;
          const { scoreMessage, autoFlag } = await import('../../modules/moderation/filter.js');
          const verdict = scoreMessage(text);
          if (verdict.decision === 'block') {
            socket.emit('game:error', { message: 'message blocked by auto-moderation' });
            try {
              const { getMongoDb } = await import('../../database/mongodb/client.js');
              await autoFlag(await getMongoDb(), userId, `game:${gameId}`, text, verdict.reasons);
            } catch {
              // flagging best-effort
            }
            return;
          }
          if (verdict.decision === 'flag') {
            void (async () => {
              try {
                const { getMongoDb } = await import('../../database/mongodb/client.js');
                await autoFlag(await getMongoDb(), userId, `game:${gameId}`, text, verdict.reasons);
              } catch {
                // flagging best-effort
              }
            })();
          }
          const g = gamesService.get(gameId);
          if (g.playerIds[0] !== userId && g.playerIds[1] !== userId) {
            socket.emit('game:error', { message: 'only players can chat here' });
            return;
          }
          // Guests can read but not send: chat is an anti-abuse surface
          // (GST-001). Ranked presets are registered-only by construction.
          try {
            const { getAuthService } = await import('../../modules/auth/service.js');
            if (await (await getAuthService()).isGuest(userId)) {
              socket.emit('game:error', { message: 'guests cannot chat — create an account to talk' });
              return;
            }
          } catch {
            // guest lookup best-effort; fall through to scope checks
          }
          // Ranked games are quick-chat only (CHT-002): no free text, no
          // strategic content, no chat-based stalling or abuse surface.
          if (g.mode === 'ranked') {
            const { isQuickChat } = await import('../../../../engine/typescript/dist/chat/index.js');
            if (!isQuickChat(text)) {
              socket.emit('game:error', { message: 'ranked games allow quick-chat only' });
              return;
            }
          }
          // Honor the sender's chat scope (friends-only restricts to friends).
          // Mutes are enforced inside the same best-effort settings lookup.
          try {
            const { getMongoDb } = await import('../../database/mongodb/client.js');
            const { SettingsRepository } = await import('../../database/mongodb/repositories/settings.repository.js');
            const { FriendRepository } = await import('../../database/mongodb/repositories/social.repository.js');
            const { BanRepository } = await import('../../database/mongodb/repositories/ops.repository.js');
            const db = await getMongoDb();
            const muted = await new BanRepository(db).mutedUntil(userId).catch(() => null);
            if (muted !== null) {
              socket.emit('game:error', { message: `muted until ${muted.toISOString()}` });
              return;
            }
            const scope = (await new SettingsRepository(db).get(userId)).chatScope;
            if (scope === 'nobody') {
              socket.emit('game:error', { message: 'chat is disabled in your settings' });
              return;
            }
            if (scope === 'friends') {
              const opp = g.playerIds[0] === userId ? g.playerIds[1] : g.playerIds[0];
              if (opp === null || !(await new FriendRepository(db).areFriends(userId, opp))) {
                socket.emit('game:error', { message: 'friends-only chat is on — befriend your opponent first' });
                return;
              }
            }
          } catch {
            // settings lookup is best-effort; default open
          }
          io.to(gameId).emit('game:chat', { from: userId, body: text, at: now });
        } catch {
          // chat never breaks the game connection
        }
      })();
    });

    socket.on('game:resign', (payload: unknown) => {
      try {
        const gameId = (payload as Record<string, unknown>)?.['gameId'];
        if (typeof gameId !== 'string') {
          socket.emit('game:error', { message: 'gameId required' });
          return;
        }
        const g = gamesService.resign(gameId, userId);
        if (!g.settled) {
          void settleFinishedGame(g)
            .then(() => persistGameFinished(g))
            .catch(() => undefined);
        }
        io.to(gameId).emit('game:state', gamesService.snapshot(g));
      } catch (err) {
        const message = err instanceof Error ? err.message : 'resign failed';
        socket.emit('game:error', { message });
      }
    });

    // Club chat: members-only rooms, persisted history, same throttle as
    // game chat. Reporting/blocking reuse the REST moderation surface.
    let lastClubChatAt = 0;
    const clubRoom = (clubId: string): string => `club:${clubId}`;
    socket.on('club:join', (payload: unknown) => {
      void (async () => {
        try {
          const clubId = (payload as Record<string, unknown>)?.['clubId'];
          if (typeof clubId !== 'string' || !/^[0-9a-fA-F]{24}$/.test(clubId)) {
            socket.emit('game:error', { message: 'clubId required' });
            return;
          }
          const { getMongoDb } = await import('../../database/mongodb/client.js');
          const { ClubRepository } = await import('../../database/mongodb/repositories/club.repository.js');
          const { ChatRepository } = await import('../../database/mongodb/repositories/chat.repository.js');
          const db = await getMongoDb();
          const members = await new ClubRepository(db).members(clubId);
          if (!members.some((m) => m.userId === userId)) {
            socket.emit('game:error', { message: 'club members only' });
            return;
          }
          await socket.join(clubRoom(clubId));
          const history = await new ChatRepository(db).history(clubRoom(clubId), 30).catch(() => []);
          socket.emit('club:history', { clubId, messages: history });
        } catch {
          socket.emit('game:error', { message: 'club join failed' });
        }
      })();
    });
    socket.on('club:chat', (payload: unknown) => {
      void (async () => {
        try {
          const obj = (payload as Record<string, unknown>) ?? {};
          const clubId = obj['clubId'];
          const body = obj['body'];
          if (typeof clubId !== 'string' || typeof body !== 'string') return;
          const text = body.trim().slice(0, 500);
          if (text.length === 0) return;
          const now = Date.now();
          if (now - lastClubChatAt < 2000) {
            socket.emit('game:error', { message: 'chatting too fast — slow down' });
            return;
          }
          lastClubChatAt = now;
          const { scoreMessage, autoFlag } = await import('../../modules/moderation/filter.js');
          const clubVerdict = scoreMessage(text);
          if (clubVerdict.decision === 'block') {
            socket.emit('game:error', { message: 'message blocked by auto-moderation' });
            return;
          }
          const { getMongoDb } = await import('../../database/mongodb/client.js');
          const { ClubRepository } = await import('../../database/mongodb/repositories/club.repository.js');
          const { ChatRepository } = await import('../../database/mongodb/repositories/chat.repository.js');
          const { BanRepository } = await import('../../database/mongodb/repositories/ops.repository.js');
          const db = await getMongoDb();
          const muted = await new BanRepository(db).mutedUntil(userId).catch(() => null);
          if (muted !== null) {
            socket.emit('game:error', { message: `muted until ${muted.toISOString()}` });
            return;
          }
          const members = await new ClubRepository(db).members(clubId).catch(() => []);
          if (!members.some((m) => m.userId === userId)) {
            socket.emit('game:error', { message: 'club members only' });
            return;
          }
          const saved = await new ChatRepository(db).post(clubRoom(clubId), userId, text).catch(() => null);
          if (clubVerdict.decision === 'flag') {
            void autoFlag(db, userId, `club:${clubId}`, text, clubVerdict.reasons);
          }
          io.to(clubRoom(clubId)).emit('club:chat', {
            clubId, from: userId, body: text, at: now,
            id: saved?._id ?? `${now}`,
          });
        } catch {
          // chat never breaks the game connection
        }
      })();
    });

    socket.on('game:reconnect', (payload: unknown) => {
      try {
        const parsed = payload as Partial<JoinPayload>;
        if (typeof parsed.gameId !== 'string') return;
        void socket.join(parsed.gameId);
        const g = gamesService.get(parsed.gameId);
        // Grace window check is on the REST session; here we just resync state.
        socket.emit('game:state', gamesService.snapshot(g));
      } catch (err) {
        const message = err instanceof Error ? err.message : 'reconnect failed';
        socket.emit('game:error', { message });
      }
    });

    // ── Multi-seat rooms (m_... game ids, `multi:state` snapshots) ──
    socket.on('multi:join', (payload: unknown) => {
      try {
        const gameId = (payload as Record<string, unknown>)?.['gameId'];
        if (typeof gameId !== 'string') {
          socket.emit('game:error', { message: 'gameId required' });
          return;
        }
        try {
          multiGamesService.join(gameId, userId);
        } catch {
          // best-effort (already seated / spectator).
        }
        void socket.join(gameId);
        const g = multiGamesService.get(gameId);
        // Fog (MLT-009): always seat-projected, even on join.
        emitMultiStateTo(io, socket.id, g, userId);
      } catch (err) {
        socket.emit('game:error', { message: err instanceof Error ? err.message : 'join failed' });
      }
    });

    const handleMultiAction = (payload: unknown): void => {
      const obj = (payload as Record<string, unknown>) ?? {};
      const gameId = obj['gameId'];
      const parsed = normalizeIntent(obj['action'] ?? obj);
      if (!parsed.success || typeof gameId !== 'string') {
        socket.emit('game:error', { message: 'invalid action payload' });
        return;
      }
      try {
        const g = multiGamesService.play(gameId, userId, parsed.data.action, {
          ...(typeof obj['actionId'] === 'string' ? { actionId: obj['actionId'] as string } : {}),
          ...(typeof obj['baseMoveNumber'] === 'number' ? { baseMoveNumber: obj['baseMoveNumber'] as number } : {}),
        });
        void persistMultiMoveAppended(g).catch(() => undefined);
        if (g.status === 'finished' && !g.settled) {
          void settleMultiGame(g).catch(() => undefined);
        }
        // Fog (MLT-009): one payload per seat, never a shared broadcast.
        emitMultiState(io, gameId, g);
      } catch (err) {
        socket.emit('game:error', { message: err instanceof Error ? err.message : 'move rejected' });
      }
    };

    socket.on('multi:move', handleMultiAction);
    socket.on('multi:wall', handleMultiAction);

    socket.on('multi:resign', (payload: unknown) => {
      try {
        const gameId = (payload as Record<string, unknown>)?.['gameId'];
        if (typeof gameId !== 'string') {
          socket.emit('game:error', { message: 'gameId required' });
          return;
        }
        const g = multiGamesService.resign(gameId, userId);
        if (!g.settled) {
          void settleMultiGame(g).catch(() => undefined);
        }
        emitMultiState(io, gameId, g);
      } catch (err) {
        socket.emit('game:error', { message: err instanceof Error ? err.message : 'resign failed' });
      }
    });

    socket.on('multi:chat', (payload: unknown) => {
      void (async () => {
        try {
          const obj = (payload as Record<string, unknown>) ?? {};
          const gameId = obj['gameId'];
          const body = obj['body'];
          if (typeof gameId !== 'string' || typeof body !== 'string') return;
          const text = body.trim().slice(0, 500);
          if (text.length === 0) return;
          const now = Date.now();
          if (now - lastChatAt < 2000) {
            socket.emit('game:error', { message: 'chatting too fast — slow down' });
            return;
          }
          lastChatAt = now;
          const { scoreMessage: multiScore, autoFlag: multiFlag } = await import('../../modules/moderation/filter.js');
          const multiVerdict = multiScore(text);
          if (multiVerdict.decision === 'block') {
            socket.emit('game:error', { message: 'message blocked by auto-moderation' });
            return;
          }
          const g = multiGamesService.get(gameId);
          if (!g.playerIds.includes(userId)) {
            socket.emit('game:error', { message: 'only players can chat here' });
            return;
          }
          try {
            const { getAuthService } = await import('../../modules/auth/service.js');
            if (await (await getAuthService()).isGuest(userId)) {
              socket.emit('game:error', { message: 'guests cannot chat — create an account to talk' });
              return;
            }
          } catch {
            // guest lookup best-effort
          }
          if (multiVerdict.decision === 'flag') {
            void (async () => {
              try {
                const { getMongoDb } = await import('../../database/mongodb/client.js');
                await multiFlag(await getMongoDb(), userId, `multi:${gameId}`, text, multiVerdict.reasons);
              } catch {
                // flagging best-effort
              }
            })();
          }
          io.to(gameId).emit('multi:chat', { from: userId, body: text, at: now });
        } catch {
          // chat never breaks the game connection
        }
      })();
    });

    socket.on('multi:reconnect', (payload: unknown) => {
      try {
        const gameId = (payload as Record<string, unknown>)?.['gameId'];
        if (typeof gameId !== 'string') return;
        void socket.join(gameId);
        const g = multiGamesService.get(gameId);
        emitMultiStateTo(io, socket.id, g, userId);
      } catch (err) {
        socket.emit('game:error', { message: err instanceof Error ? err.message : 'reconnect failed' });
      }
    });
  });

  return io;
}
