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

export interface ChatMessage {
  from: string;
  body: string;
  at: number;
}

export interface OnlineGame {
  snapshot: GameSnapshot | null;
  /** Locally interpolated clocks (server resyncs authoritatively). */
  clocks: [number, number];
  /** Action log rebuilt from authoritative snapshots (for the timeline). */
  actions: Action[];
  chat: ChatMessage[];
  meta: ({ id: string; username: string; rating: number } | null)[] | null;
  mySeat: 0 | 1 | null;
  connected: boolean;
  error: string | null;
  sendMove: (to: Pos) => void;
  sendWall: (wall: Wall) => void;
  sendResign: () => void;
  sendChat: (body: string) => void;
  sendDrawOffer: () => void;
  sendDrawResponse: (accept: boolean) => void;
  refresh: () => void;
}

export function useOnlineGame(gameId: string, userId: string | null): OnlineGame {
  const [snapshot, setSnapshot] = useState<GameSnapshot | null>(null);
  const [actions, setActions] = useState<Action[]>([]);
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [meta, setMeta] = useState<OnlineGame['meta']>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const socketRef = useRef<Socket | null>(null);
  // Interpolated display clocks: anchored to the last authoritative
  // snapshot, ticked locally each rendered second. Server resyncs win.
  const [clocks, setClocks] = useState<[number, number]>([0, 0]);
  const anchorRef = useRef<{ at: number; clockMs: [number, number]; turn: number; incrementMs: number; live: boolean } | null>(null);

  const ingest = useCallback((snap: GameSnapshot) => {
    setSnapshot(snap);
    setError(null);
    anchorRef.current = {
      at: Date.now(),
      clockMs: [...snap.clockMs] as [number, number],
      turn: snap.turn,
      incrementMs: snap.incrementMs,
      live: !(snap.isOver || snap.status === 'finished') && snap.status === 'active',
    };
    setClocks([...snap.clockMs] as [number, number]);
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
    socket.on('game:chat', (msg: ChatMessage) => {
      setChat((c) => [...c.slice(-29), msg]);
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
  // Skipped while the tab is hidden (resync on visibility return instead).
  useEffect(() => {
    if (snapshot !== null && (snapshot.isOver || snapshot.status === 'finished')) return;
    const id = setInterval(() => {
      if (!document.hidden) refresh();
    }, 2000);
    const onVisible = (): void => {
      if (!document.hidden) refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refresh, snapshot]);

  // Local interpolation between authoritative snapshots (second-granular).
  useEffect(() => {
    const id = setInterval(() => {
      const a = anchorRef.current;
      if (a === null || !a.live || document.hidden) return;
      const elapsed = Date.now() - a.at;
      setClocks((c) => {
        const next = [...c] as [number, number];
        next[a.turn as 0 | 1] = Math.max(0, a.clockMs[a.turn as 0 | 1] - elapsed);
        const shown: [number, number] = [Math.ceil(next[0] / 1000), Math.ceil(next[1] / 1000)];
        const prev: [number, number] = [Math.ceil(c[0] / 1000), Math.ceil(c[1] / 1000)];
        if (shown[0] === prev[0] && shown[1] === prev[1]) return c;
        return next;
      });
    }, 250);
    return () => clearInterval(id);
  }, []);

  const sendMove = useCallback((to: Pos) => {
    socketRef.current?.emit('game:move', { gameId, action: { type: 'move', to } });
  }, [gameId]);

  const sendWall = useCallback((wall: Wall) => {
    socketRef.current?.emit('game:wall', { gameId, action: { type: 'wall', wall } });
  }, [gameId]);

  const sendResign = useCallback(() => {
    socketRef.current?.emit('game:resign', { gameId });
  }, [gameId]);

  const sendChat = useCallback((body: string) => {
    socketRef.current?.emit('game:chat', { gameId, body });
  }, [gameId]);

  const sendDrawOffer = useCallback(() => {
    socketRef.current?.emit('game:draw_offer', { gameId });
  }, [gameId]);

  const sendDrawResponse = useCallback((accept: boolean) => {
    socketRef.current?.emit('game:draw_response', { gameId, accept });
  }, [gameId]);

  const mySeat: 0 | 1 | null = (() => {
    if (userId === null || snapshot === null) return null;
    if (snapshot.seats[0] === userId) return 0;
    if (snapshot.seats[1] === userId) return 1;
    return null;
  })();

  return { snapshot, clocks, actions, chat, meta, mySeat, connected, error, sendMove, sendWall, sendResign, sendChat, sendDrawOffer, sendDrawResponse, refresh };
}
