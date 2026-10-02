/**
 * Multi-seat realtime helpers (m_... ids).
 *
 * Fog of war (MLT-009) lives here rather than inline in gameSocket.ts because
 * it must fan out ONE snapshot per seat: every player legitimately sees a
 * different wall list, so a single shared `io.to(room).emit` would hand the
 * whole board to everyone and make the mode meaningless.
 */
import type { Server as SocketServer } from 'socket.io';
import { multiGamesService, type MultiGameRecord } from '../../modules/multiGames/service.js';

/**
 * Fan out a fog-aware state to every socket in the room, one payload per seat.
 *
 * Non-fog games take the cheap shared-broadcast path (identical payload for
 * everyone). Fog games resolve each socket's seat from its authenticated
 * `userId`; unknown or unseated sockets get the spectator view, never the full
 * board.
 */
export function emitMultiState(io: SocketServer, gameId: string, g: MultiGameRecord): void {
  if (!g.fog) {
    io.to(gameId).emit('multi:state', multiGamesService.snapshot(g));
    return;
  }
  const room = io.sockets.adapter.rooms.get(gameId);
  if (room === undefined) return;
  for (const socketId of room) {
    const sock = io.sockets.sockets.get(socketId);
    if (sock === undefined) continue;
    const uid = (sock.data as { userId?: string }).userId;
    const seat = typeof uid === 'string' ? g.playerIds.indexOf(uid) : -1;
    sock.emit('multi:state', multiGamesService.snapshot(g, seat === -1 ? null : seat));
  }
}

/** Single-recipient send (join, reconnect): always seat-projected. */
export function emitMultiStateTo(
  io: SocketServer,
  socketId: string,
  g: MultiGameRecord,
  userId: string,
): void {
  const sock = io.sockets.sockets.get(socketId);
  if (sock === undefined) return;
  const seat = g.playerIds.indexOf(userId);
  sock.emit('multi:state', multiGamesService.snapshot(g, seat === -1 ? null : seat));
}