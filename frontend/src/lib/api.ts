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
  guest: boolean;
  emailVerified?: boolean;
}

/**
 * Coarse client locality for same-region matchmaking preference
 * (IANA timezone, e.g. Europe/Berlin). Preference only, never a gate.
 */
export function clientRegion(): string | undefined {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return typeof tz === 'string' && tz.length > 0 ? tz.slice(0, 64) : undefined;
  } catch {
    return undefined;
  }
}

export interface GameSnapshot {  id: string;
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
  finishReason: 'goal' | 'timeout' | 'resign' | 'draw' | null;
  drawOfferBy: 0 | 1 | null;
  moveCount: number;
  /** Echo of the most recently applied client action id (idempotency). */
  lastActionId?: string | null;
  timeControlId: string;
  mode: string;
  createdAt: number;
  updatedAt: number;
}

export interface MultiSnapshot {
  id: string;
  status: 'waiting' | 'active' | 'finished' | 'aborted';
  state: {
    size: number;
    wallsPerPlayer: number;
    players: number;
    sides: string[];
    turn: number;
    pawns: { r: number; c: number }[];
    walls: { r: number; c: number; orientation: 'h' | 'v' }[];
    wallsRemaining: number[];
    isOver: boolean;
    winner: number | null;
    moveNumber: number;
    lastAction: { type: 'move'; to: { r: number; c: number } } | { type: 'wall'; wall: { r: number; c: number; orientation: 'h' | 'v' } } | null;
    rulesVersion: string;
  };
  seats: (string | null)[];
  clockMs: number[];
  incrementMs: number;
  turn: number;
  isOver: boolean;
  winnerSeat: number | null;
  placement: number[];
  eliminated: number[];
  continueForPlacement: boolean;
  /** Seat -> team index in team mode, null in free-for-all. */
  teamOf: number[] | null;
  winningTeam: number | null;
  teamMode: boolean;
  /** Fog of war: this snapshot is projected to the viewer's seat. */
  fog: boolean;
  /** Chaos: wall budget rotates on a cadence. */
  chaos: boolean;
  /** Siege: asymmetric economy (seat 0 has extra walls + head start). */
  siege: boolean;
  /** Walls hidden from this viewer (fog only; 0 otherwise). */
  hiddenWalls: number;
  finishReason: 'goal' | 'timeout' | 'resign' | null;
  moveCount: number;
  /** Echo of the most recently applied client action id (idempotency). */
  lastActionId?: string | null;
  timeControlId: string;
  mode: string;
  players: number;
  createdAt: number;
  updatedAt: number;
}

export const api = {
  me: () => req<{ user: SessionUser }>('/api/v1/auth/me'),
  register: (input: { email: string; username: string; password: string }) =>
    req<{ user: SessionUser }>('/api/v1/auth/register', { method: 'POST', body: JSON.stringify(input) }),
  login: (input: { login: string; password: string }) =>
    req<{ user: SessionUser }>('/api/v1/auth/login', { method: 'POST', body: JSON.stringify(input) }),
  guest: () => req<{ user: SessionUser }>('/api/v1/auth/guest', { method: 'POST' }),
  availability: (input: { email: string; username: string }) =>
    req<{ emailAvailable: boolean; usernameAvailable: boolean; checked: boolean }>(
      '/api/v1/auth/availability', { method: 'POST', body: JSON.stringify(input) },
    ),
  convert: (input: { email: string; username: string; password: string }) =>
    req<{ user: SessionUser }>('/api/v1/auth/convert', { method: 'POST', body: JSON.stringify(input) }),
  logout: () => req<{ ok: boolean }>('/api/v1/auth/logout', { method: 'POST' }),
  socketTicket: () => req<{ ticket: string; expiresInSec: number }>('/api/v1/socket/ticket', { method: 'POST' }),
  forgot: (email: string) => req<{ ok: boolean; message: string }>('/api/v1/auth/forgot', { method: 'POST', body: JSON.stringify({ email }) }),
  reset: (token: string, password: string) => req<{ ok: boolean }>('/api/v1/auth/reset', { method: 'POST', body: JSON.stringify({ token, password }) }),
  verifyRequest: () => req<{ ok: boolean; mailed: boolean }>('/api/v1/auth/verify/request', { method: 'POST' }),
  verifyConfirm: (token: string) => req<{ ok: boolean }>('/api/v1/auth/verify/confirm', { method: 'POST', body: JSON.stringify({ token }) }),

  createGame: (input: { boardSize?: number; wallsPerPlayer?: number; timeControl?: string; opponentId?: string; visibility?: string }) =>
    req<GameSnapshot>('/api/v1/games', { method: 'POST', body: JSON.stringify(input) }),
  game: (id: string) => req<GameSnapshot>(`/api/v1/games/${encodeURIComponent(id)}`),
  joinGame: (id: string) => req<GameSnapshot>(`/api/v1/games/${encodeURIComponent(id)}/join`, { method: 'POST' }),
  move: (id: string, action: unknown) =>
    req<GameSnapshot>(`/api/v1/games/${encodeURIComponent(id)}/move`, { method: 'POST', body: JSON.stringify(action) }),
  resign: (id: string) => req<GameSnapshot>(`/api/v1/games/${encodeURIComponent(id)}/resign`, { method: 'POST' }),
  drawOffer: (id: string) => req<GameSnapshot>(`/api/v1/games/${encodeURIComponent(id)}/draw-offer`, { method: 'POST' }),
  drawResponse: (id: string, accept: boolean) => req<GameSnapshot>(`/api/v1/games/${encodeURIComponent(id)}/draw-response`, { method: 'POST', body: JSON.stringify({ accept }) }),
  liveGames: () => req<{ games: { id: string; mode: string; timeControl: string; moveCount: number }[] }>('/api/v1/games/live'),
  gameMeta: (id: string) => req<{
    players: ({ id: string; username: string; rating: number } | null)[];
  }>(`/api/v1/games/${encodeURIComponent(id)}/meta`),

  mmJoin: (input: { mode?: string; timeControl?: string; region?: string }) =>
    req<{ status: 'queued' } | { status: 'matched'; gameId: string }>('/api/v1/matchmaking/join', { method: 'POST', body: JSON.stringify(input) }),  mmStatus: () => req<{ status: 'queued' } | { status: 'matched'; gameId: string }>('/api/v1/matchmaking/status'),
  mmCancel: () => req<{ ok: boolean }>('/api/v1/matchmaking/cancel', { method: 'POST' }),

  profile: (username: string) => req<{
    username: string;
    joinedAt?: string;
    views?: number;
    viewsWeek?: number;
    viewsMonth?: number;
    frame?: string;
    stats?: { seatWins: [number, number]; seatGames: [number, number]; streak: number; streakWon: boolean; winRate?: number; timeouts?: number; resignations?: number; avgDurationSec?: number };
    fairPlay?: { score: number; level: 'exemplary' | 'good' | 'caution' | 'restricted' };
    ratings: { mode: string; rating: number; peak: number; games: number; wins: number; losses: number }[];
    recentGames: { id: string; mode: string; timeControl: string; status: string; result: { winnerSeat: 0 | 1 | null; reason: string } | null; createdAt: string }[];
    degraded?: boolean;
  }>(`/api/v1/profiles/${encodeURIComponent(username)}`),
  ratingHistory: (username: string, mode: string) => req<{    mode: string;
    points: { before: number; after: number; at: string }[];
    degraded?: boolean;
  }>(`/api/v1/profiles/${encodeURIComponent(username)}/ratings/${encodeURIComponent(mode)}/history`),
  xp: (username: string) => req<{
    username: string; xp: number; level: number;
    breakdown: { finishedGames: number; puzzleSolves: number; lessons: number };
    degraded?: boolean;
  }>(`/api/v1/profiles/${encodeURIComponent(username)}/xp`),
  leaderboard: (mode = 'blitz') => req<{
    mode: string;
    entries: { rank: number; username: string; rating: number; games: number; wins: number }[];
    degraded?: boolean;
  }>(`/api/v1/leaderboard?mode=${encodeURIComponent(mode)}`),

  puzzleDaily: () => req<{
    puzzleId: string;
    date: string;
    prompt: string;
    size: number;
    turn: 0 | 1;
    pawns: [{ r: number; c: number }, { r: number; c: number }];
    walls: { r: number; c: number; orientation: 'h' | 'v' }[];
    wallsRemaining: [number, number];
    needGain: number;
    difficulty?: 'classic' | 'tricky' | 'sharp' | 'devilish';
    alternatives?: number;
    tasteSource?: 'ai' | 'default';
    streak: number;
    solvedToday: boolean;
  }>('/api/v1/puzzles/daily'),
  puzzleAttempt: (wall: { r: number; c: number; orientation: 'h' | 'v' }) => req<{
    solved: boolean;
    gain: number;
    need: number;
    legal: boolean;
    reason?: string;
    solution?: { r: number; c: number; orientation: 'h' | 'v' };
    solutionGain?: number;
    streak: number;
    solvedToday: boolean;
  }>('/api/v1/puzzles/daily/attempt', { method: 'POST', body: JSON.stringify({ wall }) }),

  friends: () => req<{ friends: { id: string; username: string; online: boolean }[] }>('/api/v1/friends'),
  multiPuzzleDaily: () => req<{
    puzzleId: string;
    date: string;
    prompt: string;
    players: number;
    size: number;
    turn: number;
    pawns: { r: number; c: number }[];
    walls: { r: number; c: number; orientation: 'h' | 'v' }[];
    wallsRemaining: number[];
    needGain: number;
    difficulty?: 'classic' | 'tricky' | 'sharp' | 'devilish';
  }>('/api/v1/puzzles/multi/daily'),
  multiPuzzleAttempt: (wall: { r: number; c: number; orientation: 'h' | 'v' }) => req<{
    solved: boolean;
    gain: number;
    need: number;
    legal: boolean;
    solution?: { r: number; c: number; orientation: 'h' | 'v' };
  }>(`/api/v1/puzzles/multi/attempt`, { method: 'POST', body: JSON.stringify({ wall }) }),
  friendRequests: () => req<{ requests: { id: string; from: string }[] }>('/api/v1/friends/requests'),
  friendRequest: (username: string) => req<{ requestId: string; to: string }>('/api/v1/friends/request', { method: 'POST', body: JSON.stringify({ username }) }),
  friendAccept: (requestId: string) => req<{ ok: boolean }>('/api/v1/friends/accept', { method: 'POST', body: JSON.stringify({ requestId }) }),
  friendBlock: (username: string) => req<{ ok: boolean }>('/api/v1/friends/block', { method: 'POST', body: JSON.stringify({ username }) }),
  dmThreads: () => req<{
    threads: { username: string; online: boolean; lastBody: string | null; lastAt: string | null }[];
  }>('/api/v1/dms'),
  dmHistory: (username: string) => req<{
    messages: { _id: string; userId: string; body: string; createdAt: string }[];
  }>(`/api/v1/dms/${encodeURIComponent(username)}`),
  dmSend: (username: string, body: string) => req<{
    message: { _id: string; userId: string; body: string; createdAt: string };
  }>(`/api/v1/dms/${encodeURIComponent(username)}`, { method: 'POST', body: JSON.stringify({ body }) }),
  cosmetics: () => req<{
    frames: { id: string; kind: string; name: string; ring: string; premium: boolean; owned: boolean }[];
    equipped: string;
  }>('/api/v1/cosmetics'),
  cosmeticEquip: (id: string) => req<{ ok: boolean; equipped: string }>(
    `/api/v1/cosmetics/${encodeURIComponent(id)}/equip`, { method: 'POST' },
  ),
  heartbeat: () => req<{ ok: boolean }>('/api/v1/presence/heartbeat', { method: 'POST' }),
  announcements: () => req<{
    announcements: { _id: string; title: string; body: string; audience: string }[];
  }>('/api/v1/announcements'),
  track: (name: string, props: Record<string, unknown> = {}) => req<{ ok: boolean }>(
    '/api/v1/analytics/event', { method: 'POST', body: JSON.stringify({ name, props }) },
  ),
  accountSettings: () => req<{
    userId: string; showRating: boolean; allowChallenges: boolean;
    chatScope: string; profileVisibility: string; historyVisibility: string;
    notifyMatches: boolean; notifyResults: boolean;
  }>('/api/v1/settings'),
  accountSettingsSave: (patch: Record<string, unknown>) => req<{
    userId: string; showRating: boolean; allowChallenges: boolean;
    chatScope: string; profileVisibility: string; historyVisibility: string;
    notifyMatches: boolean; notifyResults: boolean;
  }>('/api/v1/settings', { method: 'PUT', body: JSON.stringify(patch) }),
  passwordChange: (current: string, next: string) => req<{ ok: boolean }>(
    '/api/v1/auth/password', { method: 'POST', body: JSON.stringify({ current, next }) },
  ),
  logoutAll: () => req<{ ok: boolean; revoked: number }>('/api/v1/auth/logout-all', { method: 'POST' }),
  deleteAccount: () => req<{ ok: boolean; message: string }>('/api/v1/auth/delete', { method: 'POST' }),
  notifications: () => req<{
    notifications: { _id: string; kind: string; title: string; body?: string; read: boolean; createdAt: string }[];
    unread: number;
  }>('/api/v1/notifications'),
  notificationRead: (id: string) => req<{ ok: boolean }>(`/api/v1/notifications/${encodeURIComponent(id)}/read`, { method: 'POST' }),
  search: (q: string) => req<{
    players: { username: string }[];
    tournaments: { id: string; title: string }[];
    clubs: { id: string; name: string }[];
  }>(`/api/v1/search?q=${encodeURIComponent(q)}`),

  clubs: () => req<{
    clubs: { club: { _id: string; name: string; description: string; ownerId: string }; members: number }[];
  }>('/api/v1/clubs'),
  club: (id: string) => req<{
    club: { _id: string; name: string; description: string; ownerId: string };
    members: { id: string; username: string; role: string }[];
  }>(`/api/v1/clubs/${encodeURIComponent(id)}`),
  clubCreate: (name: string, description: string) => req<{
    club: { _id: string; name: string };
  }>('/api/v1/clubs', { method: 'POST', body: JSON.stringify({ name, description }) }),
  clubJoin: (id: string) => req<{ ok: boolean }>(`/api/v1/clubs/${encodeURIComponent(id)}/join`, { method: 'POST' }),
  clubLeave: (id: string) => req<{ ok: boolean }>(`/api/v1/clubs/${encodeURIComponent(id)}/leave`, { method: 'POST' }),
  clubChat: (id: string) => req<{
    messages: { _id: string; userId: string; body: string; createdAt: string }[];
  }>(`/api/v1/clubs/${encodeURIComponent(id)}/chat`),

  rushNext: (i: number) => req<{
    seed: string;
    puzzleId: string;
    date: string;
    prompt: string;
    size: number;
    turn: 0 | 1;
    pawns: [{ r: number; c: number }, { r: number; c: number }];
    walls: { r: number; c: number; orientation: 'h' | 'v' }[];
    wallsRemaining: [number, number];
    needGain: number;
  }>(`/api/v1/puzzles/rush/next?i=${i}`),
  rushAttempt: (seed: string, wall: { r: number; c: number; orientation: 'h' | 'v' }) => req<{
    solved: boolean; gain: number; need: number; legal: boolean;
  }>(
    '/api/v1/puzzles/rush/attempt',
    { method: 'POST', body: JSON.stringify({ seed, wall }) },
  ),
  rushStats: () => req<{
    mine: number;
    today: number;
    leaders: { rank: number; username: string; solves: number }[];
  }>('/api/v1/puzzles/rush/stats'),
  learnCurriculum: () => req<{
    lessons: {
      id: string;
      title: string;
      description: string;
      steps: {
        id: string;
        title: string;
        explain: string;
        size: number;
        wallsPerPlayer: number;
        turn: 0 | 1;
        pawns: [{ r: number; c: number }, { r: number; c: number }];
        walls: { r: number; c: number; orientation: 'h' | 'v' }[];
        wallsRemaining: [number, number];
        task: string;
        needGain: number | null;
        solved: boolean;
      }[];
    }[];
  }>('/api/v1/learn/curriculum'),
  learnAttempt: (
    lessonId: string,
    stepId: string,
    action: { type: 'move'; to: { r: number; c: number } } | { type: 'wall'; wall: { r: number; c: number; orientation: 'h' | 'v' } },
  ) => req<{ solved: boolean; detail: string; best?: string }>(
    '/api/v1/learn/attempt',
    { method: 'POST', body: JSON.stringify({ lessonId, stepId, action }) },
  ),
  learnOpenings: () => req<{
    generatedAt: string;
    board: string;
    games: number;
    openings: { line: string; games: number; whiteWinPct: number }[];
  }>('/api/v1/learn/openings'),
  nemesis: () => req<{
    games: number;
    flaws: { wallWaste: number; pathErrors: number; passive: number; missedChokes: number };
    explanation: string;
    weights: { pathAdvantage: number; wallAdvantage: number; mobility: number };
    wallCandidates: number;
    noise: number;
    wallBias: number;
    replySearch: boolean;
    budgetMs: number;
    baseName: string;
  }>('/api/v1/nemesis'),
  mirror: () => req<{
    games: number;
    moves: number;
    wallRate: number;
    avgGain: number;
    efficiency: number;
    explanation: string;
    weights: { pathAdvantage: number; wallAdvantage: number; mobility: number };
    wallCandidates: number;
    noise: number;
    wallBias: number;
    replySearch: boolean;
    budgetMs: number;
  }>('/api/v1/mirror'),
  ghostGames: () => req<{
    games: { gameId: string; timeControl: string; moves: number; result: string | null; createdAt: unknown }[];
  }>('/api/v1/ghost/games'),
  ghostGame: (id: string) => req<{
    gameId: string;
    size: number;
    wallsPerPlayer: number;
    actions: ({ type: 'move'; to: { r: number; c: number } } | { type: 'wall'; wall: { r: number; c: number; orientation: 'h' | 'v' } })[];
  }>(`/api/v1/ghost/games/${encodeURIComponent(id)}`),
  trainingMine: () => req<{
    puzzles: {
      puzzleId: string;
      gameId: string;
      seq: number;
      seat: 0 | 1;
      labels: string[];
      played: string;
      best: string;
      position: {
        puzzleId: string;
        date: string;
        prompt: string;
        size: number;
        turn: 0 | 1;
        pawns: [{ r: number; c: number }, { r: number; c: number }];
        walls: { r: number; c: number; orientation: 'h' | 'v' }[];
        wallsRemaining: [number, number];
        wallsPerPlayer: number;
        needGain: number;
      };
      solved: boolean;
    }[];
  }>('/api/v1/puzzles/mine'),
  trainingAttempt: (
    gameId: string,
    seq: number,
    action: { type: 'move'; to: { r: number; c: number } } | { type: 'wall'; wall: { r: number; c: number; orientation: 'h' | 'v' } },
  ) => req<{ solved: boolean; best: string; played: string }>(
    '/api/v1/puzzles/mine/attempt',
    { method: 'POST', body: JSON.stringify({ gameId, seq, action }) },
  ),

  coach: (input: {
    moveNumber: number;
    playedAction: string;
    bestAction: string;
    ownPathBefore: number;
    ownPathAfter: number;
    oppPathBefore: number;
    oppPathAfter: number;
    question?: string;
  }) => req<{ available: boolean; provider?: string; explanation?: string; message?: string }>(
    '/api/v1/ai/coach',
    { method: 'POST', body: JSON.stringify(input) },
  ),

  challenge: (username: string, timeControl = '3+1', mode = 'ranked') => req<{ ok: boolean }>(
    '/api/v1/challenges', { method: 'POST', body: JSON.stringify({ username, timeControl, mode }) },
  ),

  adminOverview: () => req<{
    users: number; games: { total: number; liveInMemory: number }; ratings: number; replays: number;
    tournaments: number; clubs: number; reportsOpen: number; redis: string; queueNote: string;
  }>('/api/v1/admin/overview'),
  adminStats: () => req<{
    usersPerDay: { day: string; count: number }[];
    gamesPerDay: { day: string; count: number }[];
    puzzlesPerDay: { day: string; count: number }[];
    aiUsage: { provider: string; requests: number; errors: number }[];
  }>('/api/v1/admin/stats'),
  adminQueue: () => req<{
    queue: { memory: number; redisRanked: number | null; redisOk: boolean };
    liveGames: { id: string; mode: string; timeControl: string; moveCount: number; seats: (string | null)[]; updatedAt: number }[];
  }>('/api/v1/admin/queue'),
  adminReports: (status = 'OPEN') => req<{
    reports: { _id: string; reporterId: string; targetType: string; targetId: string; reason: string; status: string; resolution?: string; createdAt: string }[];
  }>(`/api/v1/admin/reports?status=${encodeURIComponent(status)}`),
  adminReportResolve: (id: string, status: string, resolution: string) => req<{ ok: boolean }>(
    `/api/v1/admin/reports/${encodeURIComponent(id)}/resolve`,
    { method: 'POST', body: JSON.stringify({ status, resolution }) },
  ),
  adminTournaments: () => req<{
    tournaments: { _id: string; title: string; status: string; format: string; timeControl: string }[];
  }>('/api/v1/admin/tournaments'),
  adminTournamentCancel: (id: string) => req<{ ok: boolean }>(`/api/v1/admin/tournaments/${encodeURIComponent(id)}/cancel`, { method: 'POST' }),
  adminClubs: () => req<{
    clubs: { _id: string; name: string; description: string; ownerId: string; members: number }[];
  }>('/api/v1/admin/clubs'),
  adminClubDelete: (id: string) => req<{ ok: boolean }>(`/api/v1/admin/clubs/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  adminEntitlements: (userId: string) => req<{ userId: string; entitlements: string[] }>(`/api/v1/admin/entitlements?userId=${encodeURIComponent(userId)}`),
  adminGrant: (userId: string, entitlement: string) => req<{ ok: boolean }>(
    '/api/v1/admin/entitlements/grant', { method: 'POST', body: JSON.stringify({ userId, entitlement }) },
  ),
  adminRevoke: (userId: string, entitlement: string) => req<{ ok: boolean }>(
    '/api/v1/admin/entitlements/revoke', { method: 'POST', body: JSON.stringify({ userId, entitlement }) },
  ),
  report: (targetType: string, targetId: string, reason: string) => req<{ ok: boolean; id: string }>(
    '/api/v1/reports', { method: 'POST', body: JSON.stringify({ targetType, targetId, reason }) },
  ),
  adminUsers: (search: string) => req<{
    users: { id: string; username: string; email: string; role: string; status: string; createdAt: string }[];
  }>(`/api/v1/admin/users?search=${encodeURIComponent(search)}`),
  adminUser: (id: string) => req<{
    user: { id: string; username: string; email: string; role: string; status: string; createdAt: string };
    ratings: { mode: string; rating: number | null; games: number }[];
    recentGames: { id: string; status: string; result: { winnerSeat: 0 | 1 | null; reason: string } | null }[];
  }>(`/api/v1/admin/users/${encodeURIComponent(id)}`),
  adminUserStatus: (id: string, status: string) => req<{ ok: boolean }>(`/api/v1/admin/users/${encodeURIComponent(id)}/status`, { method: 'POST', body: JSON.stringify({ status }) }),
  adminGames: () => req<{
    games: { id: string; mode: string; timeControl: string; status: string; result: { winnerSeat: 0 | 1 | null; reason: string } | null; moveCount: number; createdAt: string }[];
  }>('/api/v1/admin/games/recent'),
  adminFlags: () => req<{ flags: { key: string; enabled: boolean }[] }>('/api/v1/admin/flags'),
  adminFlagSet: (key: string, enabled: boolean) => req<{ flag: { key: string; enabled: boolean } }>('/api/v1/admin/flags', { method: 'PUT', body: JSON.stringify({ key, enabled }) }),
  adminAudit: () => req<{ entries: { _id: string; actorId: string; action: string; target?: string; createdAt: string }[] }>('/api/v1/admin/audit'),

  aiStatus: () => req<{
    providers: { id: string; configured: boolean; keyHint: string | null; model: string | null }[];
    active: { id: string } | null;
  }>('/api/v1/ai/status'),

  replay: (gameId: string) => req<{
    gameId: string;
    status: string;
    initialState: { size: number; wallsPerPlayer: number };
    rulesVersion: string;
    actions: ({ type: 'move'; to: { r: number; c: number } } | { type: 'wall'; wall: { r: number; c: number; orientation: 'h' | 'v' } })[];
    result: { winnerSeat: 0 | 1 | null; reason: string } | null;
  }>(`/api/v1/replays/${encodeURIComponent(gameId)}`),

  review: (gameId: string) => req<{
    moves: {
      seq: number;
      by: 0 | 1;
      action: { type: 'move'; to: { r: number; c: number } } | { type: 'wall'; wall: { r: number; c: number; orientation: 'h' | 'v' } };
      labels: string[];
      class: string;
      ownBefore: number;
      ownAfter: number;
      oppBefore: number;
      oppAfter: number;
      best: string;
    }[];
    evalCurve: number[];
    winCurve?: number[];
    size: number;
    wallsPerPlayer: number;
    summary: {
      greatWalls: [number, number];
      wallBlunders: [number, number];
      pathBlunders: [number, number];
      tempoLosses: [number, number];
      missedChokes: [number, number];
      score: [number, number];
      accuracy: [number, number];
      classCounts?: Record<string, number>[];
    };
  }>(`/api/v1/games/${encodeURIComponent(gameId)}/review`),
  coachSummary: (gameId: string) => req<{ available: boolean; provider?: string; explanation?: string; message?: string }>(
    `/api/v1/ai/coach-summary/${encodeURIComponent(gameId)}`,
  ),
  commentate: (gameId: string) => req<{ available: boolean; provider?: string; commentary?: string; message?: string }>(
    '/api/v1/ai/commentate', { method: 'POST', body: JSON.stringify({ gameId }) },
  ),

  architectDesign: (prompt: string, mode: 'auto' | 'template' = 'auto') =>
    req<{
      ok: boolean;
      source: string | null;
      code: string | null;
      walls: { r: number; c: number; orientation: string }[];
      size: number;
      difficulty: string;
      theme: string;
      chokes: number;
      routeA: number;
      routeB: number;
      reason: string | null;
      stage: string | null;
      notes: string[];
      shareUrl: string | null;
    }>('/api/v1/architect/design', { method: 'POST', body: JSON.stringify({ prompt, mode }) }),

  multiCreate: (input: { players?: number; boardSize?: number; wallsPerPlayer?: number; timeControl?: string; visibility?: string; continueForPlacement?: boolean; teamMode?: boolean; fog?: boolean; chaos?: boolean; siege?: boolean }) =>
    req<MultiSnapshot>('/api/v1/multi/games', { method: 'POST', body: JSON.stringify(input) }),
  multiGame: (id: string) => req<MultiSnapshot>(`/api/v1/multi/games/${encodeURIComponent(id)}`),
  multiJoin: (id: string) => req<MultiSnapshot>(`/api/v1/multi/games/${encodeURIComponent(id)}/join`, { method: 'POST' }),
  multiMove: (id: string, action: unknown) =>
    req<MultiSnapshot>(`/api/v1/multi/games/${encodeURIComponent(id)}/move`, { method: 'POST', body: JSON.stringify(action) }),
  multiResign: (id: string) => req<MultiSnapshot>(`/api/v1/multi/games/${encodeURIComponent(id)}/resign`, { method: 'POST' }),
  multiMeta: (id: string) => req<{
    players: ({ id: string; username: string } | null)[];
  }>(`/api/v1/multi/games/${encodeURIComponent(id)}/meta`),
  multiLive: () => req<{ games: { id: string; players: number; timeControl: string; moveCount: number }[] }>('/api/v1/multi/games/live'),
  multiMmJoin: (input: { players?: number; timeControl?: string }) =>
    req<{ status: 'queued' } | { status: 'matched'; gameId: string }>('/api/v1/matchmaking/multi/join', { method: 'POST', body: JSON.stringify(input) }),
  multiMmStatus: () => req<{ status: 'queued' } | { status: 'matched'; gameId: string }>('/api/v1/matchmaking/multi/status'),
  multiMmCancel: () => req<{ ok: boolean }>('/api/v1/matchmaking/multi/cancel', { method: 'POST' }),
};
