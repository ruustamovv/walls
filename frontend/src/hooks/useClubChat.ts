/**
 * Club chat: socket room for live messages + REST history fallback.
 * Members only (enforced server-side on both paths).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { api } from '../lib/api.js';

export interface ClubChatMessage {
  id?: string;
  _id?: string;
  from?: string;
  userId?: string;
  body: string;
  at?: number;
  createdAt?: string;
}

function wsBase(): string {
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
  return env?.['VITE_WS_URL'] ?? window.location.origin;
}

export function useClubChat(clubId: string, userId: string | null, member: boolean) {
  const [messages, setMessages] = useState<ClubChatMessage[]>([]);
  const [connected, setConnected] = useState(false);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    if (userId === null || !member) return;
    api.clubChat(clubId)
      .then((r) => setMessages(r.messages))
      .catch(() => undefined);
    const socket = io(wsBase(), {
      path: '/socket',
      auth: (cb: (auth: Record<string, string>) => void) => {
        api.socketTicket()
          .then((t) => cb({ ticket: t.ticket }))
          .catch(() => cb({ userId }));
      },
      reconnection: true,
      reconnectionAttempts: 10,
    });
    socketRef.current = socket;
    socket.on('connect', () => {
      setConnected(true);
      socket.emit('club:join', { clubId });
    });
    socket.on('disconnect', () => setConnected(false));
    socket.on('club:history', (payload: { clubId: string; messages: ClubChatMessage[] }) => {
      if (payload.clubId === clubId) setMessages(payload.messages);
    });
    socket.on('club:chat', (msg: ClubChatMessage & { clubId: string }) => {
      if (msg.clubId === clubId) {
        setMessages((m) => [...m.slice(-49), msg]);
      }
    });
    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [clubId, userId, member]);

  const send = useCallback((body: string) => {
    socketRef.current?.emit('club:chat', { clubId, body });
  }, [clubId]);

  return { messages, connected, send };
}
