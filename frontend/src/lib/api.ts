/**
 * Typed fetch client for /api/v1. Same-origin + cookies; Bearer fallback
 * via localStorage for non-browser flows. Throws ApiError on non-2xx with
 * the server's message (never raw stacks — the backend redacts those).
 */
const BASE = '';

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function token(): string | null {
  try {
    return localStorage.getItem('nexus_token');
  } catch {
    return null;
  }
}

async function req<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const t = token();
  if (t !== null) headers['Authorization'] = `Bearer ${t}`;
  const res = await fetch(`${BASE}${path}`, { credentials: 'include', ...init, headers: { ...headers, ...(init.headers as Record<string, string> ?? {}) } });
  const body = (await res.json().catch(() => ({}))) as { message?: string };
  if (!res.ok) throw new ApiError(res.status, typeof body.message === 'string' ? body.message : `Request failed (${res.status})`);
  return body as T;
}

export interface SessionUser {
  id: string;
  email: string;
  username: string;
  role: string;
}

export interface GameSnapshot {
  id: string;
  status: 'waiting' | 'active' | 'finished' | 'aborted';
  state: {
    size: number;
    wallsPerPlayer: number;
    turn: 0 | 1;
    pawns: [{ r: number; c: number }, { r: number; c: number }];
    walls: { r: number; c: number; orientation: 'h' | 'v' }[];
    wallsRemaining: [number, number];
    isOver: boolean;
    winner: 0 | 1 | null;
    moveNumber: number;
    lastAction: { type: 'move'; to: { r: number; c: number } } | { type: 'wall'; wall: { r: number; c: number; orientation: 'h' | 'v' } } | null;
    rulesVersion: string;
  };
  seats: [string | null, string | null];
  clockMs: [number, number];
  incrementMs: number;
  turn: number;
  isOver: boolean;
  winnerSeat: 0 | 1 | null;
  finishReason: 'goal' | 'timeout' | 'resign' | null;
  moveCount: number;
  timeControlId: string;
  mode: string;
}

export const api = {
  me: () => req<{ user: SessionUser }>('/api/v1/auth/me'),
  register: (input: { email: string; username: string; password: string }) =>
    req<{ user: SessionUser }>('/api/v1/auth/register', { method: 'POST', body: JSON.stringify(input) }),
  login: (input: { login: string; password: string }) =>
    req<{ user: SessionUser }>('/api/v1/auth/login', { method: 'POST', body: JSON.stringify(input) }),
  logout: () => req<{ ok: boolean }>('/api/v1/auth/logout', { method: 'POST' }),

  createGame: (input: { boardSize?: number; wallsPerPlayer?: number; timeControl?: string; opponentId?: string }) =>
    req<GameSnapshot>('/api/v1/games', { method: 'POST', body: JSON.stringify(input) }),
  game: (id: string) => req<GameSnapshot>(`/api/v1/games/${encodeURIComponent(id)}`),
  joinGame: (id: string) => req<GameSnapshot>(`/api/v1/games/${encodeURIComponent(id)}/join`, { method: 'POST' }),
  move: (id: string, action: unknown) =>
    req<GameSnapshot>(`/api/v1/games/${encodeURIComponent(id)}/move`, { method: 'POST', body: JSON.stringify(action) }),
  resign: (id: string) => req<GameSnapshot>(`/api/v1/games/${encodeURIComponent(id)}/resign`, { method: 'POST' }),
  liveGames: () => req<{ games: { id: string; mode: string; timeControl: string; moveCount: number }[] }>('/api/v1/games/live'),
  gameMeta: (id: string) => req<{
    players: ({ id: string; username: string; rating: number } | null)[];
  }>(`/api/v1/games/${encodeURIComponent(id)}/meta`),

  mmJoin: (input: { mode?: string; timeControl?: string }) =>
    req<{ status: 'queued' } | { status: 'matched'; gameId: string }>('/api/v1/matchmaking/join', { method: 'POST', body: JSON.stringify(input) }),
  mmStatus: () => req<{ status: 'queued' } | { status: 'matched'; gameId: string }>('/api/v1/matchmaking/status'),
  mmCancel: () => req<{ ok: boolean }>('/api/v1/matchmaking/cancel', { method: 'POST' }),

  profile: (username: string) => req<{
    username: string;
    joinedAt?: string;
    ratings: { mode: string; rating: number; peak: number; games: number; wins: number; losses: number }[];
    recentGames: { id: string; mode: string; timeControl: string; status: string; result: { winnerSeat: 0 | 1 | null; reason: string } | null; createdAt: string }[];
    degraded?: boolean;
  }>(`/api/v1/profiles/${encodeURIComponent(username)}`),
  leaderboard: (mode = 'blitz') => req<{
    mode: string;
    entries: { rank: number; username: string; rating: number; games: number; wins: number }[];
    degraded?: boolean;
  }>(`/api/v1/leaderboard?mode=${encodeURIComponent(mode)}`),

  aiStatus: () => req<{
    providers: { id: string; configured: boolean; keyHint: string | null; model: string | null }[];
    active: { id: string } | null;
  }>('/api/v1/ai/status'),
};
