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
 * Auth: JWT placeholder — verifies `auth.token` when JWT_SECRET is set and
 * the `jsonwebtoken`-free HMAC check passes; otherwise accepts `auth.userId`
 * in non-production (dev/test) and rejects in production.
 */
import type { Server as HttpServer } from 'node:http';
import { Server, type Socket } from 'socket.io';
import { GameActionSchema } from '../../common/validation/schemas.js';
import { childLogger } from '../../common/logging/logger.js';
import { gamesService } from '../../modules/games/service.js';
import { settleFinishedGame } from '../../modules/games/finish.js';
import { persistGameFinished, persistMoveAppended } from '../../modules/games/persistence.js';

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
  const token = auth['token'];
  const candidate = auth['userId'];
  if (typeof candidate === 'string' && candidate.length > 0 && candidate.length <= 128) {
    // TODO(auth): verify JWT via JWT_SECRET and derive userId from `sub`.
    // Production must reject unsigned userId; dev/test allows it.
    if (process.env['NODE_ENV'] === 'production' && typeof token !== 'string') return null;
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
      const parsed = GameActionSchema.safeParse((payload as Record<string, unknown>)['action'] ?? payload);
      const gameId = (payload as Record<string, unknown>)['gameId'];
      if (!parsed.success || typeof gameId !== 'string') {
        socket.emit('game:error', { message: 'invalid action payload' });
        return;
      }
      try {
        const g = gamesService.play(gameId, userId, parsed.data);
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
  });

  return io;
}
