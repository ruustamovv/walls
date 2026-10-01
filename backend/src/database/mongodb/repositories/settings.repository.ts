/**
 * Per-user settings: privacy, notification and challenge preferences.
 * Single document per user, upserted on save. IDs stay strings.
 */
import type { Db } from 'mongodb';
import { COLLECTIONS } from '../collections.js';

export type ChatScope = 'everyone' | 'friends' | 'nobody';

export type Visibility = 'public' | 'friends' | 'private';

export interface UserSettings {
  userId: string;
  showRating: boolean;
  allowChallenges: boolean;
  chatScope: ChatScope;
  profileVisibility: Visibility;
  historyVisibility: Visibility;
  notifyMatches: boolean;
  notifyResults: boolean;
  updatedAt: Date;
}

const DEFAULTS: Omit<UserSettings, 'userId' | 'updatedAt'> = {
  showRating: true,
  allowChallenges: true,
  chatScope: 'everyone',
  profileVisibility: 'public',
  historyVisibility: 'public',
  notifyMatches: true,
  notifyResults: true,
};

function asVisibility(v: unknown): Visibility {
  return v === 'friends' || v === 'private' ? v : 'public';
}

function toSettings(raw: Record<string, unknown>, userId: string): UserSettings {
  return {
    userId,
    showRating: raw['showRating'] !== false,
    allowChallenges: raw['allowChallenges'] !== false,
    chatScope: raw['chatScope'] === 'friends' || raw['chatScope'] === 'nobody' ? raw['chatScope'] : 'everyone',
    profileVisibility: asVisibility(raw['profileVisibility']),
    historyVisibility: asVisibility(raw['historyVisibility']),
    notifyMatches: raw['notifyMatches'] !== false,
    notifyResults: raw['notifyResults'] !== false,
    updatedAt: (raw['updatedAt'] as Date | undefined) ?? new Date(),
  };
}

export class SettingsRepository {
  constructor(private readonly db: Db) {}

  async get(userId: string): Promise<UserSettings> {
    const raw = await this.db.collection(COLLECTIONS.user_settings).findOne({ userId }).catch(() => null);
    if (raw === null) return { ...DEFAULTS, userId, updatedAt: new Date() };
    return toSettings(raw as unknown as Record<string, unknown>, userId);
  }

  async save(userId: string, patch: Partial<Omit<UserSettings, 'userId' | 'updatedAt'>>): Promise<UserSettings> {
    const clean: Record<string, unknown> = {};
    if (typeof patch.showRating === 'boolean') clean['showRating'] = patch.showRating;
    if (typeof patch.allowChallenges === 'boolean') clean['allowChallenges'] = patch.allowChallenges;
    if (patch.chatScope === 'everyone' || patch.chatScope === 'friends' || patch.chatScope === 'nobody') {
      clean['chatScope'] = patch.chatScope;
    }
    if (patch.profileVisibility === 'public' || patch.profileVisibility === 'friends' || patch.profileVisibility === 'private') {
      clean['profileVisibility'] = patch.profileVisibility;
    }
    if (patch.historyVisibility === 'public' || patch.historyVisibility === 'friends' || patch.historyVisibility === 'private') {
      clean['historyVisibility'] = patch.historyVisibility;
    }
    if (typeof patch.notifyMatches === 'boolean') clean['notifyMatches'] = patch.notifyMatches;
    if (typeof patch.notifyResults === 'boolean') clean['notifyResults'] = patch.notifyResults;
    clean['updatedAt'] = new Date();
    await this.db.collection(COLLECTIONS.user_settings).updateOne(
      { userId },
      { $set: clean, $setOnInsert: { userId } },
      { upsert: true },
    );
    return this.get(userId);
  }
}
