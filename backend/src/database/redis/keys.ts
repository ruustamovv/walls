/**
 * Centralized Redis key factory. All backend code must build keys here —
 * never scatter raw `pn:...` strings across modules.
 */
function prefix(): string {
  return process.env['REDIS_PREFIX'] ?? 'pn';
}

export const redisKeys = {
  matchmakingQueue: (mode: string, timeControl: string) => `${prefix()}:matchmaking:${mode}:${timeControl}`,
  matchmakingTicket: (userId: string) => `${prefix()}:matchmaking:ticket:${userId}`,
  game: (gameId: string) => `${prefix()}:game:${gameId}`,
  gameLock: (gameId: string) => `${prefix()}:lock:game:${gameId}`,
  presence: (userId: string) => `${prefix()}:presence:${userId}`,
  rateLimit: (scope: string, key: string) => `${prefix()}:ratelimit:${scope}:${key}`,
  aiRateLimit: (userId: string) => `${prefix()}:ratelimit:ai:${userId}`,
  session: (sessionId: string) => `${prefix()}:sess:${sessionId}`,
  gameChannel: (gameId: string) => `${prefix()}:chan:game:${gameId}`,
} as const;
