/**
 * Online multiplayer controller: socket.io multi:* events + REST polling
 * for clock sync. Server-authoritative; this hook only renders snapshots
 * and forwards intents.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { api, type MultiSnapshot } from '../lib/api.js';
import type { MultiAction, MultiPos, MultiWall } from '../../../engine/typescript/index.js';
import type { ChatMessage } from './useOnlineGame.js';

function wsBase(): string {
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
  return env?.['VITE_WS_URL'] ?? window.location.origin;
}

export interface OnlineMultiGame {
  snapshot: MultiSnapshot | null;
  clocks: number[];
  actions: MultiAction[];
  chat: ChatMessage[];
  meta: ({ id: string; username: string } | null)[] | null;
  mySeat: number | null;
  connected: boolean;
  error: string | null;
  sendMove: (to: MultiPos) => void;
  sendWall: (wall: MultiWall) => void;
  sendResign: () => void;
  sendChat: (body: string) => void;
  refresh: () => void;
}

export function useOnlineMultiGame(gameId: string, userId: string | null): OnlineMultiGame {
  const [snapshot, setSnapshot] = useState<MultiSnapshot | null>(null);
  const [actions, setActions] = useState<MultiAction[]>([]);
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [meta, setMeta] = useState<OnlineMultiGame['meta']>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clocks, setClocks] = useState<number[]>([]);
  const socketRef = useRef<Socket | null>(null);
  const anchorRef = useRef<{ at: number; clockMs: number[]; turn: number; incrementMs: number; live: boolean } | null>(null);

  const ingest = useCallback((snap: MultiSnapshot) => {
    setSnapshot(snap);
    setError(null);
    anchorRef.current = {
      at: Date.now(),
      clockMs: [...snap.clockMs],
      turn: snap.turn,
      incrementMs: snap.incrementMs,
      live: !snap.isOver && snap.status === 'active',
    };
    setClocks([...snap.clockMs]);
    setActions((prev) => {
      const n = snap.state.moveNumber;
      if (n === prev.length && snap.state.lastAction !== null && snap.state.lastAction !== undefined) {
        return prev;
      }
      if (n < prev.length || snap.state.lastAction === null || snap.state.lastAction === undefined) {
        return n === 0 ? [] : prev;
      }
      if (n === prev.length + 1) {
        return [...prev, snap.state.lastAction as MultiAction];
      }
      return prev;
    });
  }, []);

  const refresh = useCallback(() => {
    api.multiGame(gameId).then(ingest).catch((err: unknown) => {
      setError(err instanceof Error ? err.message : 'Failed to load game');
    });
  }, [gameId, ingest]);

  useEffect(() => {
    refresh();
    api.multiMeta(gameId).then((m) => setMeta(m.players)).catch(() => setMeta(null));
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
      socket.emit('multi:join', { gameId });
      refresh();
    });
    socket.on('disconnect', () => setConnected(false));
    socket.on('multi:state', (snap: MultiSnapshot) => {
      if (snap.id === gameId) ingest(snap);
    });
    socket.on('multi:chat', (msg: ChatMessage) => {
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

  // Clock sync poll (skipped while tab hidden; resync on return).
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

  // Local interpolation between authoritative snapshots.
  useEffect(() => {
    const id = setInterval(() => {
      const a = anchorRef.current;
      if (a === null || !a.live || document.hidden) return;
      const elapsed = Date.now() - a.at;
      setClocks((c) => {
        const next = [...c];
        next[a.turn] = Math.max(0, (a.clockMs[a.turn] ?? 0) - elapsed);
        const shown = next.map((v) => Math.ceil(v / 1000)).join(',');
        const prev = c.map((v) => Math.ceil(v / 1000)).join(',');
        if (shown === prev) return c;
        return next;
      });
    }, 250);
    return () => clearInterval(id);
  }, []);

  const sendMove = useCallback((to: MultiPos) => {
    socketRef.current?.emit('multi:move', { gameId, action: { type: 'move', to } });
  }, [gameId]);

  const sendWall = useCallback((wall: MultiWall) => {
    socketRef.current?.emit('multi:wall', { gameId, action: { type: 'wall', wall } });
  }, [gameId]);

  const sendResign = useCallback(() => {
    socketRef.current?.emit('multi:resign', { gameId });
  }, [gameId]);

  const sendChat = useCallback((body: string) => {
    socketRef.current?.emit('multi:chat', { gameId, body });
  }, [gameId]);

  const mySeat: number | null = (() => {
    if (userId === null || snapshot === null) return null;
    const idx = snapshot.seats.indexOf(userId);
    return idx === -1 ? null : idx;
  })();

  return { snapshot, clocks, actions, chat, meta, mySeat, connected, error, sendMove, sendWall, sendResign, sendChat, refresh };
}
