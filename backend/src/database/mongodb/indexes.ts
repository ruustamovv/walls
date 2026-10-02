/**
 * Typed collection accessor + index bootstrap.
 * `ensureIndexes()` is idempotent — safe to run at startup and from
 * `pnpm db:indexes`. Keep the index set minimal but sufficient for
 * leaderboard / history / replay lookups.
 */
import type { Db } from 'mongodb';
import { COLLECTIONS } from './collections.js';

export async function ensureIndexes(db: Db): Promise<string[]> {
  const created: string[] = [];
  const ensure = async (collection: string, spec: Record<string, 1 | -1>, opts?: { unique?: boolean; sparse?: boolean; name?: string; expireAfterSeconds?: number }) => {
    await db.collection(collection).createIndex(spec, opts ?? {});
    created.push(`${collection}:${opts?.name ?? JSON.stringify(spec)}`);
  };

  await ensure(COLLECTIONS.users, { username: 1 }, { unique: true });
  await ensure(COLLECTIONS.users, { email: 1 }, { unique: true });
  await ensure(COLLECTIONS.users, { createdAt: 1 });
  await ensure(COLLECTIONS.profiles, { userId: 1 }, { unique: true });
  await ensure(COLLECTIONS.sessions, { userId: 1 });
  await ensure(COLLECTIONS.sessions, { expiresAt: 1 });
  await ensure(COLLECTIONS.password_resets, { tokenHash: 1 }, { unique: true, name: 'tokenHash_1' });
  await ensure(COLLECTIONS.user_settings, { userId: 1 }, { unique: true, name: 'user_settings_user' });
  await ensure(COLLECTIONS.announcements, { startsAt: -1 });
  await ensure(COLLECTIONS.bans, { userId: 1, createdAt: -1 });
  await ensure(COLLECTIONS.ai_quotas, { userId: 1, day: 1 }, { unique: true, name: 'ai_quotas_user_day' });
  await ensure(COLLECTIONS.rush_solves, { userId: 1, date: -1 });
  await ensure(COLLECTIONS.rush_solves, { seed: 1, userId: 1 }, { unique: true, sparse: true, name: 'rush_seed_user' });
  await ensure(COLLECTIONS.lesson_progress, { userId: 1, lessonId: 1 }, { unique: true, name: 'lesson_user_lesson' });
  await ensure(COLLECTIONS.analytics_events, { name: 1, createdAt: -1 });
  await ensure(COLLECTIONS.password_resets, { expiresAt: 1 });

  await ensure(COLLECTIONS.games, { engineId: 1 }, { unique: true, sparse: true, name: 'engineId_1' });
  await ensure(COLLECTIONS.games, { status: 1, createdAt: -1 });
  await ensure(COLLECTIONS.games, { createdAt: -1 });
  await ensure(COLLECTIONS.games, { 'players.userId': 1, createdAt: -1 }, { name: 'players.userId_1_createdAt_-1' });

  await ensure(COLLECTIONS.game_moves, { gameId: 1, sequence: 1 }, { unique: true });
  await ensure(COLLECTIONS.game_events, { gameId: 1, serverAt: 1 });

  await ensure(COLLECTIONS.ratings, { userId: 1, mode: 1 }, { unique: true });
  await ensure(COLLECTIONS.ratings, { mode: 1, rating: -1 });
  await ensure(COLLECTIONS.rating_history, { userId: 1, mode: 1, createdAt: 1 });

  await ensure(COLLECTIONS.replays, { gameId: 1 }, { unique: true });
  await ensure(COLLECTIONS.replays, { hash: 1 });

  await ensure(COLLECTIONS.friends, { userId: 1 });
  await ensure(COLLECTIONS.friend_requests, { toUserId: 1, status: 1 });
  await ensure(COLLECTIONS.blocks, { userId: 1, blockedId: 1 }, { unique: true, name: 'blocks_user_blocked' });
  await ensure(COLLECTIONS.puzzles, { puzzleId: 1 }, { unique: true, sparse: true, name: 'puzzleId_1' });
  await ensure(COLLECTIONS.clubs, { createdAt: -1 });
  await ensure(COLLECTIONS.club_members, { clubId: 1 });
  await ensure(COLLECTIONS.club_members, { userId: 1 });
  await ensure(COLLECTIONS.chat_messages, { channelId: 1, createdAt: -1 });
  await ensure(COLLECTIONS.entitlements, { userId: 1, entitlement: 1 }, { unique: true, name: 'entitlements_user_ent' });
  await ensure(COLLECTIONS.reports, { status: 1, createdAt: -1 });
  await ensure(COLLECTIONS.moderation_cases, { status: 1, createdAt: -1 });
  // Queue dedupe lookup: one OPEN case per (user, kind).
  await ensure(COLLECTIONS.moderation_cases, { userId: 1, kind: 1, status: 1 }, { name: 'moderation_cases_user_kind' });
  await ensure(COLLECTIONS.notifications, { userId: 1, createdAt: -1 });
  await ensure(COLLECTIONS.fairplay, { userId: 1 }, { unique: true, name: 'fairplay_user' });
  await ensure(COLLECTIONS.profile_view_days, { userId: 1, day: 1 }, { unique: true, name: 'profile_view_days_user_day' });
  await ensure(COLLECTIONS.profile_view_days, { createdAt: 1 }, { expireAfterSeconds: 90 * 86_400, name: 'profile_view_days_ttl' });
  await ensure(COLLECTIONS.tournaments, { status: 1, startAt: 1 });
  await ensure(COLLECTIONS.tournament_players, { tournamentId: 1, userId: 1 }, { unique: true, name: 'tournament_players_unique' });
  await ensure(COLLECTIONS.tournament_players, { tournamentId: 1, joinedAt: 1 }, { name: 'tournament_players_order' });
  await ensure(COLLECTIONS.tournament_rounds, { tournamentId: 1, round: 1 }, { unique: true, name: 'tournament_rounds_unique' });
  await ensure(COLLECTIONS.bot_profiles, { key: 1 }, { unique: true, name: 'bot_profiles_key' });
  await ensure(COLLECTIONS.inventories, { userId: 1, slot: 1 }, { unique: true, name: 'inventories_user_slot' });
  await ensure(COLLECTIONS.email_verifications, { tokenHash: 1 }, { unique: true, name: 'email_verifications_token' });
  await ensure(COLLECTIONS.email_verifications, { expiresAt: 1 }, { expireAfterSeconds: 7 * 86_400, name: 'email_verifications_ttl' });
  // Webhook idempotency: the provider does a bare findOne({eventId}) before
  // processing, so this index must be unique or duplicate deliveries race.
  await ensure(COLLECTIONS.stripe_events, { eventId: 1 }, { unique: true, name: 'stripe_events_event' });
  await ensure(COLLECTIONS.stripe_events, { createdAt: -1 }, { name: 'stripe_events_created' });

  await ensure(COLLECTIONS.puzzle_attempts, { userId: 1, puzzleId: 1, createdAt: -1 }, { name: 'puzzle_attempts_lookup' });
  await ensure(COLLECTIONS.admin_audit_logs, { createdAt: -1 });
  await ensure(COLLECTIONS.analytics_events, { createdAt: -1 });
  await ensure(COLLECTIONS.feature_flags, { key: 1 }, { unique: true });

  return created;
}
