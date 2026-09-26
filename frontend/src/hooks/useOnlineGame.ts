/**
 * Online game controller: socket.io for moves, REST polling for clock sync.
 * The server is authoritative — this hook renders snapshots and forwards
 * intents, never deciding legality or time itself.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { api, type GameSnapshot } from '../lib/api.js';
import type { Action, Pos, Wall } from '../../../engine/typescript/core/types.js';

function wsBase(): string {
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
  return env?.['VITE_WS_URL'] ?? window.location.origin;
}

export interface OnlineGame {
  snapshot: GameSnapshot | null;
  /** Action log rebuilt from authoritative snapshots (for the timeline). */
  actions: Action[];
  meta: ({ id: string; username: string; rating: number } | null)[] | null;
  mySeat: 0 | 1 | null;
  connected: boolean;
  error: string | null;
  sendMove: (to: Pos) => void;
  sendWall: (wall: Wall) => void;
  sendResign: () => void;
  refresh: () => void;
}

export function useOnlineGame(gameId: string, userId: string | null): OnlineGame {
  const [snapshot, setSnapshot] = useState<GameSnapshot | null>(null);
  const [actions, setActions] = useState<Action[]>([]);
  const [meta, setMeta] = useState<OnlineGame['meta']>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const socketRef = useRef<Socket | null>(null);

  const ingest = useCallback((snap: GameSnapshot) => {
    setSnapshot(snap);
    setError(null);
    // Rebuild the timeline from authoritative snapshots: the server only
    // sends full state, so track lastAction by moveNumber.
    setActions((prev) => {
      const n = snap.state.moveNumber;
      if (n === prev.length && snap.state.lastAction !== null && snap.state.lastAction !== undefined) {
        return prev;
      }
      if (n < prev.length || snap.state.lastAction === null || snap.state.lastAction === undefined) {
        return n === 0 ? [] : prev;
      }
      if (n === prev.length + 1) {
        return [...prev, snap.state.lastAction as Action];
      }
      return prev; // gap (missed transition) — keep what we have
    });
  }, []);

  const refresh = useCallback(() => {
    api.game(gameId).then(ingest).catch((err: unknown) => {
      setError(err instanceof Error ? err.message : 'Failed to load game');
    });
  }, [gameId, ingest]);

  useEffect(() => {
    refresh();
    api.gameMeta(gameId).then((m) => setMeta(m.players)).catch(() => setMeta(null));
  }, [gameId, refresh]);

  useEffect(() => {
    if (userId === null) return;
    const socket = io(wsBase(), {
      path: '/socket',
      auth: { userId },
      reconnectionAttempts: 10,
      reconnectionDelay: 800,
    });
    socketRef.current = socket;
    socket.on('connect', () => {
      setConnected(true);
      setError(null);
      socket.emit('game:join', { gameId });
      // Resync authoritative state after every (re)connect.
      refresh();
    });
    socket.on('disconnect', () => setConnected(false));
    socket.on('game:state', (snap: GameSnapshot) => {
      if (snap.id === gameId) ingest(snap);
    });
    socket.on('game:error', (payload: { message?: string }) => {
      setError(payload.message ?? 'Move rejected');
    });
    socket.on('connect_error', (err: Error) => {
      setError(err.message);
    });
    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [gameId, userId, refresh]);

  // Clock sync poll: server ticks authoritatively on every read.
  useEffect(() => {
    if (snapshot !== null && (snapshot.isOver || snapshot.status === 'finished')) return;
    const id = setInterval(refresh, 2000);
    return () => clearInterval(id);
  }, [refresh, snapshot]);

  const sendMove = useCallback((to: Pos) => {
    socketRef.current?.emit('game:move', { gameId, action: { type: 'move', to } });
  }, [gameId]);

  const sendWall = useCallback((wall: Wall) => {
    socketRef.current?.emit('game:wall', { gameId, action: { type: 'wall', wall } });
  }, [gameId]);

  const sendResign = useCallback(() => {
    socketRef.current?.emit('game:resign', { gameId });
  }, [gameId]);

  const mySeat: 0 | 1 | null = (() => {
    if (userId === null || snapshot === null) return null;
    if (snapshot.seats[0] === userId) return 0;
    if (snapshot.seats[1] === userId) return 1;
    return null;
  })();

  return { snapshot, actions, meta, mySeat, connected, error, sendMove, sendWall, sendResign, refresh };
}
