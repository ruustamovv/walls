/**
 * Admin API client — same backend (/api/v1), cookie session + Bearer fallback.
 */
export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function req<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    credentials: 'include',
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
  const body = (await res.json().catch(() => ({}))) as { message?: string };
  if (!res.ok) throw new ApiError(res.status, typeof body.message === 'string' ? body.message : `Request failed (${res.status})`);
  return body as T;
}

export interface AdminUser {
  id: string;
  username: string;
  email: string;
  role: string;
  status: string;
  createdAt: string;
}

export const api = {
  login: (login: string, password: string) =>
    req<{ user: { id: string; username: string; role: string } }>('/api/v1/auth/login', { method: 'POST', body: JSON.stringify({ login, password }) }),
  me: () => req<{ user: { id: string; username: string; role: string } }>('/api/v1/auth/me'),
  logout: () => req<{ ok: boolean }>('/api/v1/auth/logout', { method: 'POST' }),

  overview: () => req<{
    users: number; games: { total: number; liveInMemory: number }; ratings: number; replays: number;
    tournaments: number; clubs: number; reportsOpen: number; redis: string;
    aiBudget: number; aiSpendUsd: number;
    fairplayOpen: number; queueDepth: number; premiumSubs: number; puzzlePacks: number;
  }>('/api/v1/admin/overview'),
  stats: () => req<{
    usersPerDay: { day: string; count: number }[];
    gamesPerDay: { day: string; count: number }[];
    puzzlesPerDay: { day: string; count: number }[];
    aiUsage: { provider: string; requests: number; errors: number; spendUsd: number }[];
    topEvents: { name: string; count: number }[];
  }>('/api/v1/admin/stats'),
  queue: () => req<{
    queue: { memory: number; redisRanked: number | null; redisOk: boolean };
    liveGames: { id: string; mode: string; timeControl: string; moveCount: number }[];
  }>('/api/v1/admin/queue'),

  users: (search: string) => req<{ users: AdminUser[] }>(`/api/v1/admin/users?search=${encodeURIComponent(search)}`),
  user: (id: string) => req<{
    user: AdminUser;
    ratings: { mode: string; rating: number | null; games: number }[];
    recentGames: { id: string; status: string; result: { winnerSeat: 0 | 1 | null; reason: string } | null }[];
  }>(`/api/v1/admin/users/${encodeURIComponent(id)}`),
  userStatus: (id: string, status: string) => req<{ ok: boolean }>(`/api/v1/admin/users/${encodeURIComponent(id)}/status`, { method: 'POST', body: JSON.stringify({ status }) }),
  entitlements: (userId: string) => req<{ userId: string; entitlements: string[] }>(`/api/v1/admin/entitlements?userId=${encodeURIComponent(userId)}`),
  grant: (userId: string, entitlement: string) => req<{ ok: boolean }>('/api/v1/admin/entitlements/grant', { method: 'POST', body: JSON.stringify({ userId, entitlement }) }),
  revoke: (userId: string, entitlement: string) => req<{ ok: boolean }>('/api/v1/admin/entitlements/revoke', { method: 'POST', body: JSON.stringify({ userId, entitlement }) }),

  games: () => req<{
    games: { id: string; mode: string; timeControl: string; status: string; result: { winnerSeat: 0 | 1 | null; reason: string } | null; moveCount: number; createdAt: string }[];
  }>('/api/v1/admin/games/recent'),
  tournaments: () => req<{
    tournaments: { _id: string; title: string; status: string; format: string; timeControl: string }[];
  }>('/api/v1/admin/tournaments'),
  tournamentCancel: (id: string) => req<{ ok: boolean }>(`/api/v1/admin/tournaments/${encodeURIComponent(id)}/cancel`, { method: 'POST' }),
  clubs: () => req<{
    clubs: { _id: string; name: string; description: string; ownerId: string; members: number }[];
  }>('/api/v1/admin/clubs'),
  clubDelete: (id: string) => req<{ ok: boolean }>(`/api/v1/admin/clubs/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  reports: (status = 'OPEN') => req<{
    reports: { _id: string; reporterId: string; targetType: string; targetId: string; reason: string; status: string; resolution?: string; createdAt: string }[];
  }>(`/api/v1/admin/reports?status=${encodeURIComponent(status)}`),
  reportResolve: (id: string, status: string, resolution: string) => req<{ ok: boolean }>(
    `/api/v1/admin/reports/${encodeURIComponent(id)}/resolve`, { method: 'POST', body: JSON.stringify({ status, resolution }) },
  ),
  reportAiReview: (id: string) => req<{ available: boolean; provider?: string; verdict?: string; message?: string }>(
    `/api/v1/admin/reports/${encodeURIComponent(id)}/ai-review`, { method: 'POST' },
  ),
  cases: (status = 'OPEN') => req<{
    cases: {
      _id: string;
      userId: string;
      kind: 'rapid-move-streak' | 'same-pair-ranked-wins' | 'loss-streak-sandbagging';
      summary: string;
      evidence: Record<string, unknown>;
      status: string;
      resolution?: string;
      createdAt: string;
    }[];
  }>(`/api/v1/admin/cases?status=${encodeURIComponent(status)}`),
  caseResolve: (id: string, status: string, resolution: string) => req<{ ok: boolean }>(
    `/api/v1/admin/cases/${encodeURIComponent(id)}/resolve`, { method: 'POST', body: JSON.stringify({ status, resolution }) },
  ),
  billing: () => req<{
    provider: string; checkoutReady: boolean; reason: string;
    recentEvents: { eventId: string; type: string; userId: string; createdAt: unknown }[];
    grantsByEntitlement: { entitlement: string; count: number }[];
  }>('/api/v1/admin/billing'),

  aiStatus: () => req<{
    providers: { id: string; configured: boolean; keyHint: string | null; model: string | null }[];
    active: { id: string } | null;
  }>('/api/v1/ai/status'),
  flags: () => req<{ flags: { key: string; enabled: boolean }[] }>('/api/v1/admin/flags'),
  flagSet: (key: string, enabled: boolean) => req<{ flag: { key: string; enabled: boolean } }>('/api/v1/admin/flags', { method: 'PUT', body: JSON.stringify({ key, enabled }) }),
  warn: (id: string, message: string) => req<{ ok: boolean }>(`/api/v1/admin/users/${encodeURIComponent(id)}/warn`, { method: 'POST', body: JSON.stringify({ message }) }),
  mute: (id: string, minutes: number, reason: string) => req<{ ok: boolean; until: string }>(
    `/api/v1/admin/users/${encodeURIComponent(id)}/mute`, { method: 'POST', body: JSON.stringify({ minutes, reason }) },
  ),
  bans: () => req<{ bans: { _id: string; userId: string; type: string; reason: string; until: string | null; by: string; createdAt: string }[] }>('/api/v1/admin/bans'),
  quotaGet: (userId: string) => req<{ userId: string; day: string; limit: number | null }>(`/api/v1/admin/ai/quotas?userId=${encodeURIComponent(userId)}`),
  quotaSet: (userId: string, limit: number) => req<{ ok: boolean }>(
    '/api/v1/admin/ai/quotas', { method: 'POST', body: JSON.stringify({ userId, limit }) },
  ),
  audit: (filter: { action?: string; actor?: string } = {}) => {
    const q = new URLSearchParams();
    if (filter.action !== undefined && filter.action !== '') q.set('action', filter.action);
    if (filter.actor !== undefined && filter.actor !== '') q.set('actor', filter.actor);
    const qs = q.toString();
    return req<{ entries: { _id: string; actorId: string; action: string; target?: string; createdAt: string }[] }>(
      `/api/v1/admin/audit${qs === '' ? '' : `?${qs}`}`,
    );
  },
  announcements: () => req<{
    announcements: { _id: string; title: string; body: string; audience: string; startsAt: string; endsAt: string | null }[];
  }>('/api/v1/admin/announcements'),
  announcementCreate: (title: string, body: string, audience: string, days: number) => req<{ announcement: { _id: string } }>(
    '/api/v1/admin/announcements', { method: 'POST', body: JSON.stringify({ title, body, audience, days }) },
  ),
  announcementDelete: (id: string) => req<{ ok: boolean }>(`/api/v1/admin/announcements/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  chatDelete: (id: string) => req<{ ok: boolean }>(`/api/v1/admin/chat/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  gameAnnul: (id: string) => req<{ ok: boolean }>(`/api/v1/admin/games/${encodeURIComponent(id)}/annul`, { method: 'POST' }),
};
