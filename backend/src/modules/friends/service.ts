/**
 * Friends: requests, acceptance, listing with best-effort presence,
 * blocking. Challenging reuses game creation with opponentId.
 */
import { getMongoDb } from '../../database/mongodb/client.js';
import { UserRepository } from '../../database/mongodb/repositories/user.repository.js';
import { FriendRepository } from '../../database/mongodb/repositories/social.repository.js';
import { logger } from '../../common/logging/logger.js';

const PRESENCE_TTL_SEC = 120;

export async function heartbeat(userId: string): Promise<void> {
  try {
    const { getRedis } = await import('../../database/redis/client.js');
    const { redisKeys } = await import('../../database/redis/keys.js');
    await getRedis().set(redisKeys.presence(userId), '1', 'EX', PRESENCE_TTL_SEC);
  } catch {
    // presence is advisory only
  }
}

export async function onlineMap(userIds: string[]): Promise<Map<string, boolean>> {
  const out = new Map<string, boolean>();
  try {
    const { getRedis } = await import('../../database/redis/client.js');
    const { redisKeys } = await import('../../database/redis/keys.js');
    const r = getRedis();
    await Promise.all(userIds.map(async (id) => {
      try {
        out.set(id, (await r.exists(redisKeys.presence(id))) === 1);
      } catch {
        out.set(id, false);
      }
    }));
  } catch {
    for (const id of userIds) out.set(id, false);
  }
  return out;
}

async function repos(): Promise<{ friends: FriendRepository; users: UserRepository }> {
  const db = await getMongoDb();
  return { friends: new FriendRepository(db), users: new UserRepository(db) };
}

export async function sendRequest(fromUserId: string, username: string): Promise<{ requestId: string; to: string }> {
  const { friends, users } = await repos();
  const target = await users.findByUsername(username);
  if (target === null) throw new Error('player not found');
  const doc = await friends.request(fromUserId, target._id);
  try {
    const { NotificationRepository } = await import('../../database/mongodb/repositories/extended.repositories.js');
    const db = await getMongoDb();
    const me = await users.findById(fromUserId).catch(() => null);
    await new NotificationRepository(db).create({
      userId: target._id, kind: 'friend_request',
      title: `${me?.username ?? 'Someone'} sent you a friend request`,
    }).catch(() => undefined);
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'friend notification failed');
  }
  return { requestId: doc._id, to: target.username };
}

export async function acceptRequest(userId: string, requestId: string): Promise<boolean> {
  const { friends } = await repos();
  return friends.accept(requestId, userId);
}

export async function listFriends(userId: string): Promise<{ id: string; username: string; online: boolean }[]> {
  const { friends, users } = await repos();
  const rows = await friends.list(userId);
  const presence = await onlineMap(rows.map((r) => r.friendId));
  const out: { id: string; username: string; online: boolean }[] = [];
  for (const r of rows) {
    const u = await users.findById(r.friendId).catch(() => null);
    out.push({ id: r.friendId, username: u?.username ?? 'unknown', online: presence.get(r.friendId) ?? false });
  }
  return out;
}

export async function incomingRequests(userId: string): Promise<{ id: string; from: string }[]> {
  const { friends, users } = await repos();
  const rows = await friends.incoming(userId);
  const out: { id: string; from: string }[] = [];
  for (const r of rows) {
    const u = await users.findById(r.fromUserId).catch(() => null);
    out.push({ id: r._id, from: u?.username ?? 'unknown' });
  }
  return out;
}

export async function blockUser(userId: string, username: string): Promise<void> {
  const { friends, users } = await repos();
  const target = await users.findByUsername(username);
  if (target === null) throw new Error('player not found');
  await friends.block(userId, target._id);
}
