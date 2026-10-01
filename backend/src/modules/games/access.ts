/**
 * Game visibility policy (RPL-002): who may spectate live games and open
 * replays. Public/unlisted: anyone (unlisted just hides from directories).
 * Friends: players + confirmed friends. Private: players only.
 */
import type { Db } from 'mongodb';
import type { GameVisibility } from './service.js';

export async function canViewGame(
  db: Db,
  game: { visibility?: GameVisibility | string; playerIds: (string | null)[] },
  viewerId: string | null,
): Promise<boolean> {
  const visibility = (game.visibility ?? 'public') as GameVisibility;
  if (visibility === 'public' || visibility === 'unlisted') return true;
  if (viewerId !== null && game.playerIds.includes(viewerId)) return true;
  if (visibility === 'private' || viewerId === null) return false;
  // friends: any confirmed friendship with any seated player.
  try {
    const { FriendRepository } = await import('../../database/mongodb/repositories/social.repository.js');
    const friends = new FriendRepository(db);
    for (const pid of game.playerIds) {
      if (pid === null) continue;
      if (await friends.areFriends(viewerId, pid).catch(() => false)) return true;
    }
  } catch {
    // lookup best-effort; default deny above already returned for private
  }
  return false;
}
